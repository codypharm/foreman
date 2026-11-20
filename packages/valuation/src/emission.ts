// BEM emission schedule, mirroring the sealed PoD mining contract on BNB Chain
// (logic contract 0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898, `_emissionBetween`).
// See docs/notes/2026-11-18-mining-contract-findings.md.
// All values are bigint: timestamps in seconds, amounts in base units (8 decimals).

/** When emission started: 21 Aug 2026, 13:15:32 UTC (contract `startTime`). */
const START_TIME = 1_787_318_132n;

import { ValuationInputError } from "./errors.ts";

/** 50 BEM per 600 seconds, rounded down per second as the contract does. */
const INITIAL_RATE = (50n * 10n ** 8n) / 600n;

/** 210,000 ten-minute blocks, as in Bitcoin: about 3.995 years. */
const HALVING_PERIOD = 126_000_000n;

/** The first halving: 18 Aug 2030, 21:15:32 UTC. Payback and the long window end here. */
export const FIRST_HALVING = START_TIME + HALVING_PERIOD;

/** BEM emitted between two timestamps, in base units. */
export function emissionBetween(from: bigint, to: bigint): bigint {
	if (to < from) {
		throw new ValuationInputError(
			`Emission window ends (${to}) before it starts (${from})`,
		);
	}
	const start = from < START_TIME ? START_TIME : from;
	if (to <= start) return 0n;

	// Sum era by era: the rate in era e is INITIAL_RATE >> e
	let total = 0n;
	let segmentStart = start;
	while (segmentStart < to) {
		const era = (segmentStart - START_TIME) / HALVING_PERIOD;
		const rate = INITIAL_RATE >> era;
		if (rate === 0n) break; // emission has ended (after era 22)
		const eraEnd = START_TIME + (era + 1n) * HALVING_PERIOD;
		const segmentEnd = to < eraEnd ? to : eraEnd;
		total += (segmentEnd - segmentStart) * rate;
		segmentStart = segmentEnd;
	}
	return total;
}
