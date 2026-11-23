// Small facts about circuits in the product's words, shared by the result page's sections.

import type { CircuitRef, Multiplier } from "@foreman/contract";
import { shortHex } from "../../format.ts";

/** The two eligible processors (CLAUDE.md, "On-chain facts", 20 Nov 2026); every other has multiplier 0. */
const ELIGIBLE: Readonly<Record<string, Exclude<Multiplier, 0>>> = {
	"0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c": 6,
	"0xb1024b89886b9a34aa4ff5f31c411d708b20a14c": 1,
};

/** "processor ×6", or the processor's short address when it isn't eligible. */
export function processorLabel(processor: string): string {
	const m = ELIGIBLE[processor.toLowerCase()];
	return m ? `processor ×${m}` : `processor ${shortHex(processor)}`;
}

/**
 * A circuit's design time: its design commitment when the mining contract accepted one, otherwise its
 * tape-out (CLAUDE.md, "The earliest proven design is the original").
 */
export function designTime(c: CircuitRef): {
	block: bigint;
	time: bigint;
	by: "commitment" | "tape-out";
} {
	return c.designCommittedAt
		? { ...c.designCommittedAt, by: "commitment" }
		: { block: c.tapedOutAt.block, time: c.tapedOutAt.time, by: "tape-out" };
}

export const circuitName = (c: CircuitRef) => `#${c.tokenId.toString()}`;

/** The can-mine fact in the product's words (CLAUDE.md, "Domain language"). */
export const CAN_MINE = {
	mining: "Mining now",
	"cant-mine": "Can’t mine",
	stopped: "Not mining: stopped",
	"not-started": "Could mine: not started",
} as const;
