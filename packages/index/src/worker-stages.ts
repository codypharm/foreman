// Each worker stage's last outcome (docs/decisions/2026-11-23-hosting.md, decision 7): the worker
// records one per stage after every run, and GET /health reads them. Only the latest of each kind
// is kept: when the stage last finished, last chose not to run, and last failed.

import type pg from "pg";

export type WorkerStage = "follow" | "refresh" | "publish";

export const WORKER_STAGES: readonly WorkerStage[] = [
	"follow",
	"refresh",
	"publish",
];

/** One outcome as the worker reports it: a summary line, or the reason it failed. */
export type StageRecord =
	| { status: "done"; summary: string }
	| { status: "skipped"; summary: string }
	| { status: "failed"; detail: string };

/** When it happened (unix seconds) and the line the worker logged. */
export interface StageEvent {
	at: bigint;
	text: string;
}

export interface StageState {
	stage: WorkerStage;
	lastDone: StageEvent | null;
	lastSkipped: StageEvent | null;
	lastFailed: StageEvent | null;
}

const COLUMNS = {
	done: ["last_done_at", "last_done_summary"],
	skipped: ["last_skipped_at", "last_skipped_summary"],
	failed: ["last_failed_at", "last_failed_detail"],
} as const;

export async function recordStage(
	pool: pg.Pool,
	stage: WorkerStage,
	outcome: StageRecord,
	at: bigint,
): Promise<void> {
	const [atColumn, textColumn] = COLUMNS[outcome.status];
	const text = outcome.status === "failed" ? outcome.detail : outcome.summary;
	await pool.query(
		`insert into worker_stages (stage, ${atColumn}, ${textColumn}) values ($1, $2, $3)
		 on conflict (stage) do update set ${atColumn} = excluded.${atColumn}, ${textColumn} = excluded.${textColumn}`,
		[stage, at.toString(), text],
	);
}

/** Every stage, in run order; a stage with no outcome yet has all three null. */
export async function readStages(pool: pg.Pool): Promise<StageState[]> {
	const rows = await pool.query<{
		stage: WorkerStage;
		last_done_at: string | null;
		last_done_summary: string | null;
		last_skipped_at: string | null;
		last_skipped_summary: string | null;
		last_failed_at: string | null;
		last_failed_detail: string | null;
	}>("select * from worker_stages");
	const byStage = new Map(rows.rows.map((r) => [r.stage, r]));
	const event = (
		at: string | null | undefined,
		text: string | null | undefined,
	) => (at == null ? null : { at: BigInt(at), text: text ?? "" });
	return WORKER_STAGES.map((stage) => {
		const r = byStage.get(stage);
		return {
			stage,
			lastDone: event(r?.last_done_at, r?.last_done_summary),
			lastSkipped: event(r?.last_skipped_at, r?.last_skipped_summary),
			lastFailed: event(r?.last_failed_at, r?.last_failed_detail),
		};
	});
}
