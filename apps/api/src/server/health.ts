// GET /health (docs/decisions/2026-11-23-hosting.md, decision 7): whether the hosted worker is
// keeping up. Each stage reports when it last finished, last chose not to run and last failed. A
// stage with no finish in the last 30 minutes is behind, and then so is the whole: the API answers
// 503, which an uptime checker can watch. A publish skipped for want of a key is "not publishing",
// which isn't behind: that's a setting, not a fault. This is for whoever runs Foreman, not for the
// web app, so it isn't a data contract shape.

import {
	readStages,
	type StageEvent,
	type StageState,
	type WorkerStage,
} from "@foreman/index";
import type pg from "pg";

export const BEHIND_AFTER_SECONDS = 30n * 60n;

export type StageHealth = "ok" | "behind" | "not-publishing";

export interface Health {
	status: "ok" | "behind";
	stages: (StageState & { health: StageHealth })[];
}

export function healthOf(stages: StageState[], now: bigint): Health {
	const judged = stages.map((s) => ({ ...s, health: stageHealth(s, now) }));
	return {
		status: judged.some((s) => s.health === "behind") ? "behind" : "ok",
		stages: judged,
	};
}

function stageHealth(s: StageState, now: bigint): StageHealth {
	const latest = (e: StageEvent | null) => e?.at ?? -1n;
	if (
		s.stage === "publish" &&
		s.lastSkipped &&
		s.lastSkipped.at > latest(s.lastDone) &&
		s.lastSkipped.at > latest(s.lastFailed)
	) {
		return "not-publishing";
	}
	return s.lastDone && now - s.lastDone.at <= BEHIND_AFTER_SECONDS
		? "ok"
		: "behind";
}

/** The response body: times as ISO strings with minutes ago, so a person can read it as it is. */
export async function readHealth(
	pool: pg.Pool,
	now: bigint,
): Promise<{ status: 200 | 503; body: unknown }> {
	let stages: StageState[];
	let blocks:
		| { up_to_block: string; results_changes_up_to_block: string | null }
		| undefined;
	try {
		stages = await readStages(pool);
		// The results block stays put while a refresh skips circuits, so a refresh that "finishes"
		// every run but never moves it shows here as a gap behind the index
		const state = await pool.query<{
			up_to_block: string;
			results_changes_up_to_block: string | null;
		}>("select up_to_block, results_changes_up_to_block from index_state");
		blocks = state.rows[0];
	} catch (error) {
		return {
			status: 503,
			body: {
				status: "behind",
				detail: `The database can't be read: ${error instanceof Error ? error.message : String(error)}`,
			},
		};
	}
	const health = healthOf(stages, now);
	const event = (e: StageEvent | null) =>
		e && {
			at: new Date(Number(e.at) * 1000).toISOString(),
			minutesAgo: Number((now - e.at) / 60n),
			text: e.text,
		};
	return {
		status: health.status === "ok" ? 200 : 503,
		body: {
			status: health.status,
			checkedAt: new Date(Number(now) * 1000).toISOString(),
			behindAfterMinutes: Number(BEHIND_AFTER_SECONDS / 60n),
			index: {
				upToBlock: blocks?.up_to_block ?? null,
				resultsUpToBlock: blocks?.results_changes_up_to_block ?? null,
			},
			stages: Object.fromEntries(
				health.stages.map((s) => [
					s.stage satisfies WorkerStage,
					{
						health: s.health,
						lastDone: event(s.lastDone),
						lastSkipped: event(s.lastSkipped),
						lastFailed: event(s.lastFailed),
					},
				]),
			),
		},
	};
}
