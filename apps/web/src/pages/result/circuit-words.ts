// Small facts about circuits in the product's words, shared by the result page's sections.

import type { CircuitRef, Multiplier } from "@foreman/contract";
import { shortHex } from "../../format.ts";

/** The two eligible processors (CLAUDE.md, "On-chain facts", 20 Nov 2026); every other has multiplier 0. */
const ELIGIBLE: Readonly<Record<string, Exclude<Multiplier, 0>>> = {
	"0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c": 6,
	"0xb1024b89886b9a34aa4ff5f31c411d708b20a14c": 1,
};

/** FabX's processor on X Layer (CLAUDE.md, "On-chain facts", 25 Nov 2026). */
const FABX_PROCESSOR = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6";

/** "processor ×6", "FabX’s processor", or the processor's short address when it isn't eligible. */
export function processorLabel(processor: string): string {
	if (processor.toLowerCase() === FABX_PROCESSOR) return "FabX’s processor";
	const m = ELIGIBLE[processor.toLowerCase()];
	return m ? `processor ×${m}` : `processor ${shortHex(processor)}`;
}

export const CHAIN = { 56: "BNB Chain", 196: "X Layer" } as const;
/** How a block is named on screen: "BNB block", "X Layer block". */
export const BLOCK = { 56: "BNB block", 196: "X Layer block" } as const;

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

/** "#97", or "#97 on BNB Chain" when it is on another chain than the result's own circuit. */
export const circuitFrom = (c: CircuitRef, me: CircuitRef) =>
	c.chainId === me.chainId
		? circuitName(c)
		: `${circuitName(c)} on ${CHAIN[c.chainId]}`;

/** The can-mine fact in the product's words (CLAUDE.md, "Domain language"). */
export const CAN_MINE = {
	mining: "Mining now",
	"cant-mine": "Can’t mine",
	stopped: "Not mining: stopped",
	"not-started": "Could mine: not started",
} as const;
