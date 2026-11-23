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

/**
 * The publisher wallet's balance as last read (docs/decisions/2026-11-23-low-balance-warning.md),
 * in wei, with the chain, the address and when (unix seconds).
 */
export interface PublisherBalance {
	chainId: number;
	address: string;
	wei: bigint;
	at: bigint;
}

export async function recordPublisherBalance(
	pool: pg.Pool,
	b: PublisherBalance,
): Promise<void> {
	await pool.query(
		`insert into publisher_balance (chain_id, address, balance_wei, read_at) values ($1, $2, $3, $4)
		 on conflict (chain_id) do update set address = excluded.address,
		   balance_wei = excluded.balance_wei, read_at = excluded.read_at`,
		[b.chainId, b.address, b.wei.toString(), b.at.toString()],
	);
}

/** The most recent read on any chain; null when it was never read, never a zero balance. */
export async function readPublisherBalance(
	pool: pg.Pool,
): Promise<PublisherBalance | null> {
	const rows = await pool.query<{
		chain_id: number;
		address: string;
		balance_wei: string;
		read_at: string;
	}>(
		"select chain_id, address, balance_wei, read_at from publisher_balance order by read_at desc limit 1",
	);
	const r = rows.rows[0];
	return r
		? {
				chainId: r.chain_id,
				address: r.address,
				wei: BigInt(r.balance_wei),
				at: BigInt(r.read_at),
			}
		: null;
}
