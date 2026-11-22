// The results job (docs/decisions/2026-11-21-stored-results.md): keeps a complete result for every
// miner and listed circuit in the results table. After each follow it rebuilds what the follow
// touched (and anything without a row yet); once an hour it rebuilds them all, which catches what
// the follow can't see (a miner stopping, a cooling miner able to restart, changed counts). A
// failed build keeps the circuit's last complete row; a run with a failure moves no block, so the
// next run tries again. Read only on chain.

import {
	circuitsTouchedSince,
	readResultsState,
	readStoredCircuits,
	saveResults,
} from "@foreman/index";
import type { CircuitId } from "@foreman/originality";
import type pg from "pg";
import type { PublicClient } from "viem";
import {
	circuitsToPublish,
	collectResults,
	type Skipped,
	type Target,
} from "../publish/collect.ts";
import { loadResultContext } from "../result.ts";

/** How long a full rebuild stands before the next run rebuilds everything again. */
export const FULL_REBUILD_SECONDS = 3_600n;

export type RefreshResult =
	| {
			refreshed: true;
			mode: "full" | "changes";
			indexBlock: bigint;
			built: number;
			skipped: Skipped[];
			removed: number;
	  }
	| { refreshed: false; detail: string };

export async function refreshResults(
	pool: pg.Pool,
	client: PublicClient,
	options: {
		/** auto: full when the last full rebuild is an hour old or there is none, otherwise changes. */
		mode: "auto" | "full" | "changes";
		/** Unix seconds. */
		now: bigint;
		concurrency?: number;
		onProgress?: (done: number, of: number) => void;
	},
): Promise<RefreshResult> {
	const loaded = await loadResultContext(pool, client);
	if (!loaded.ready) return { refreshed: false, detail: loaded.detail };
	const ctx = loaded.context;
	const indexBlock = ctx.index.upToBlock;

	const state = await readResultsState(pool);
	const mode =
		options.mode !== "auto"
			? options.mode
			: state.fullAt === null ||
					state.changesUpTo === null ||
					options.now - state.fullAt >= FULL_REBUILD_SECONDS
				? "full"
				: "changes";
	if (mode === "changes" && state.changesUpTo === null) {
		return {
			refreshed: false,
			detail: "no full rebuild yet: the first run must rebuild everything",
		};
	}
	if (state.changesUpTo !== null && indexBlock < state.changesUpTo) {
		return {
			refreshed: false,
			detail: `the index is at block ${indexBlock}, behind the stored results' ${state.changesUpTo}`,
		};
	}

	const targets = await circuitsToPublish(pool);
	const stored = new Set((await readStoredCircuits(pool)).map(name));
	const wanted = new Set(targets.map((t) => name(t.circuit)));
	let toBuild: Target[];
	if (mode === "full") {
		toBuild = targets;
	} else {
		const touched = new Set(
			(await circuitsTouchedSince(pool, state.changesUpTo as bigint)).map(name),
		);
		toBuild = targets.filter(
			(t) => touched.has(name(t.circuit)) || !stored.has(name(t.circuit)),
		);
	}
	const remove = (await readStoredCircuits(pool)).filter(
		(c) => !wanted.has(name(c)),
	);

	const { results, skipped } = await collectResults(ctx, toBuild, {
		concurrency: options.concurrency ?? 200,
		...(options.onProgress ? { onProgress: options.onProgress } : {}),
	});
	await saveResults(pool, {
		mode: skipped.length > 0 ? "partial" : mode,
		indexBlock,
		builtAt: options.now,
		results,
		remove,
	});
	return {
		refreshed: true,
		mode,
		indexBlock,
		built: results.length,
		skipped,
		removed: remove.length,
	};
}

const name = (c: CircuitId) => `${c.processor.toLowerCase()}/${c.id}`;
