// The index loaded once for building pasted circuits' results on request, and loaded again when
// the follow has moved it, so a pasted result is never checked against an older index than the
// stored ones.

import type pg from "pg";
import type { PublicClient } from "viem";
import { loadResultContext, type ResultContext } from "../result.ts";

type Loaded =
	| { ready: true; context: ResultContext }
	| { ready: false; detail: string };

export function cachedResultContext(
	pool: pg.Pool,
	client: PublicClient,
): () => Promise<Loaded> {
	let cached: { block: string; loaded: Promise<Loaded> } | undefined;
	return async () => {
		const { rows } = await pool.query<{ up_to_block: string | null }>(
			"select up_to_block::text from index_state",
		);
		const block = rows[0]?.up_to_block ?? "none";
		if (cached?.block !== block) {
			const loaded = loadResultContext(pool, client);
			cached = { block, loaded };
			// A failed load is tried again on the next request, never kept
			loaded.catch(() => {
				if (cached?.loaded === loaded) cached = undefined;
			});
		}
		return cached.loaded;
	};
}
