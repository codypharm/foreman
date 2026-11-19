import type { Hex32 } from "@foreman/contract";

/** The mining contract has no miner under this key. Never shown as a miner with zero weight. */
export class UnknownMinerError extends Error {
	override name = "UnknownMinerError";
	readonly key: Hex32;

	constructor(key: Hex32) {
		super(`No miner with key ${key} in the BNB mining contract`);
		this.key = key;
	}
}

/**
 * The chain returned something our reading of the verified source says cannot happen.
 * Deny by default: stop and surface it rather than guess what it means.
 */
export class ChainReadError extends Error {
	override name = "ChainReadError";
}
