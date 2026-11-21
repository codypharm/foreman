// Splitting a plan into transactions by count and by size. X Layer's node refuses a transaction
// over 131,072 bytes ("oversized data", testnet, 21 Nov 2026), and results vary from about 1,000 to
// 1,600 bytes, so a fixed count alone can overshoot. Each batch's calldata stays under a budget
// that leaves room for the rest of the signed transaction.

import type { PlanEntry } from "./plan.ts";

/** The node's limit on a whole signed transaction, in bytes. */
export const MAX_TRANSACTION_BYTES = 131_072;
/** Calldata per batch: the limit less ample room for the signature, fees, nonce and addresses. */
export const MAX_BATCH_CALLDATA = 120_000;

/** Bytes of `publish(Entry[])` calldata for these entries, exactly as ABI-encoded. */
export function publishCalldataSize(entries: PlanEntry[]): number {
	// selector 4 + array offset 32 + array length 32, then per entry its own size
	return 68 + entries.reduce((n, e) => n + entrySize(e), 0);
}

export function batchEntries(
	entries: PlanEntry[],
	options: { maxEntries: number },
): PlanEntry[][] {
	const batches: PlanEntry[][] = [];
	let batch: PlanEntry[] = [];
	let size = 68;
	for (const e of entries) {
		const s = entrySize(e);
		if (68 + s > MAX_BATCH_CALLDATA) {
			throw new Error(
				`the result for ${e.processor}/${e.id} is too large for one transaction (${68 + s} bytes of calldata)`,
			);
		}
		if (batch.length === options.maxEntries || size + s > MAX_BATCH_CALLDATA) {
			batches.push(batch);
			batch = [];
			size = 68;
		}
		batch.push(e);
		size += s;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

/**
 * One entry: its offset in the array head (32), its six head words (processor, circuitId, kind,
 * canMine, indexBlock, the result's offset: 192), the result's length word (32) and its bytes
 * padded to 32.
 */
function entrySize(e: PlanEntry): number {
	const bytes = (e.result.length - 2) / 2;
	return 32 + 192 + 32 + Math.ceil(bytes / 32) * 32;
}
