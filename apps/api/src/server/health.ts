// GET /health (docs/decisions/2026-11-23-hosting.md, decision 7): whether the hosted worker is
// keeping up. Each stage reports when it last finished, last chose not to run and last failed. A
// stage with no finish in the last 30 minutes is behind, and then so is the whole: the API answers
// 503, which an uptime checker can watch. A publish skipped for want of a key is "not publishing",
// which isn't behind: that's a setting, not a fault. A publisher wallet under 0.05 OKB is "low
// balance", also 503, so a wallet running out of gas shows before it is empty
// (docs/decisions/2026-11-23-low-balance-warning.md). FabX's follow is judged the same way unless
// FabX is frozen ("frozen", never behind) or its history isn't stored ("not-following")
// (2026-11-26-fabx-follow.md, decision 4). This is for whoever runs Foreman, not for the web app, so
// it isn't a data contract shape.

import {
	type PublisherBalance,
	readFabxState,
	readPublisherBalance,
	readStages,
	type StageEvent,
	type StageState,
	type WorkerStage,
} from "@foreman/index";
import type pg from "pg";
import { formatUnits } from "viem";

export const BEHIND_AFTER_SECONDS = 30n * 60n;

/** 0.05 OKB: about 500 publishes at 23 Nov 2026 testnet prices. */
export const LOW_BALANCE_WEI = 5n * 10n ** 16n;

export type StageHealth =
	| "ok"
	| "behind"
	| "not-publishing"
	| "low-balance"
	| "frozen"
	| "not-following";

/** FabX's stored state, or null when its history isn't stored. */
export type FabxHealthInput = { frozenAtBlock: bigint | null } | null;

export interface Health {
	status: "ok" | "behind" | "low-balance";
	stages: (StageState & { health: StageHealth })[];
}

export function healthOf(
	stages: StageState[],
	now: bigint,
	balance: PublisherBalance | null = null,
	fabx: FabxHealthInput = null,
): Health {
	const judged = stages.map((s) => {
		let health = stageHealth(s, now);
		if (s.stage === "fabx") {
			if (fabx === null) health = "not-following";
			else if (fabx.frozenAtBlock !== null) health = "frozen";
		}
		// A low balance names the likely reason a publish is failing, so it replaces "behind" on
		// the publish stage; while publishing is off it isn't judged
		if (
			s.stage === "publish" &&
			health !== "not-publishing" &&
			balance &&
			balance.wei < LOW_BALANCE_WEI
		) {
			health = "low-balance";
		}
		return { ...s, health };
	});
	return {
		status: judged.some((s) => s.health === "behind")
			? "behind"
			: judged.some((s) => s.health === "low-balance")
				? "low-balance"
				: "ok",
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
	let balance: PublisherBalance | null;
	let fabx: Awaited<ReturnType<typeof readFabxState>>;
	let blocks:
		| { up_to_block: string; results_changes_up_to_block: string | null }
		| undefined;
	try {
		stages = await readStages(pool);
		balance = await readPublisherBalance(pool);
		fabx = await readFabxState(pool);
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
	const health = healthOf(stages, now, balance, fabx);
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
			// Null until FabX's history is stored
			fabx: fabx && {
				upToBlock: fabx.logsUpToBlock.toString(),
				frozenAtBlock: fabx.frozenAtBlock?.toString() ?? null,
			},
			// Null until a publish run has read it, never a zero balance
			publisher: balance && {
				chainId: balance.chainId,
				address: balance.address,
				balanceOkb: formatUnits(balance.wei, 18),
				lowBelowOkb: formatUnits(LOW_BALANCE_WEI, 18),
				readAt: new Date(Number(balance.at) * 1000).toISOString(),
				minutesAgo: Number((now - balance.at) / 60n),
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
