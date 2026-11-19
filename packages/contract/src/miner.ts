// Miner: what Foreman knows about one miner, read from the BNB mining contract.
// A product shape, not a mirror of getMiner (docs/decisions/2026-11-19-data-contract.md).

import { type BnbRead, parseBnbRead, serialiseBnbRead } from "./bnb.ts";
import { ContractParseError } from "./errors.ts";
import {
	type Address,
	type Hex32,
	parseAddress,
	parseBoolean,
	parseHex32,
	parseObject,
	parseOneOf,
	parseUint,
	serialiseUint,
} from "./wire.ts";

export interface Miner {
	key: Hex32;
	/** The NFT contract (`circuits` in the mining contract). */
	processor: Address;
	/** `circuitId` in the mining contract. */
	tokenId: bigint;
	/** Current NFT holder; claims mint here. */
	owner: Address;
	status: "active" | "cooling" | "revoked" | "not-mining";
	pool: "verified" | "unverified";
	/** null when unverified. */
	taskId: number | null;
	weight: bigint;
	/** bstar × mult; equals weight when the miner holds no bonus. */
	weightWithoutBonus: bigint;
	holdsBonus: boolean;
	/** Unix seconds. */
	miningSince: bigint;
	readAt: BnbRead;
}

const STATUSES = ["active", "cooling", "revoked", "not-mining"] as const;
const POOLS = ["verified", "unverified"] as const;

/** A miner for the wire. Parses its own output, so it never sends what readers would refuse. */
export function serialiseMiner(
	miner: Miner,
	field: string,
): Record<string, unknown> {
	const wire = {
		key: miner.key,
		processor: miner.processor,
		tokenId: serialiseUint(miner.tokenId, `${field}.tokenId`),
		owner: miner.owner,
		status: miner.status,
		pool: miner.pool,
		taskId: miner.taskId,
		weight: serialiseUint(miner.weight, `${field}.weight`),
		weightWithoutBonus: serialiseUint(
			miner.weightWithoutBonus,
			`${field}.weightWithoutBonus`,
		),
		holdsBonus: miner.holdsBonus,
		miningSince: serialiseUint(miner.miningSince, `${field}.miningSince`),
		readAt: serialiseBnbRead(miner.readAt, `${field}.readAt`),
	};
	parseMiner(wire, field);
	return wire;
}

/** A verified miner has a task (1 or more); an unverified one has none (the contract's 0). */
function parseTaskId(
	wire: unknown,
	field: string,
	pool: Miner["pool"],
): number | null {
	if (pool === "unverified") {
		if (wire !== null) {
			throw new ContractParseError(field, "null for an unverified miner", wire);
		}
		return null;
	}
	if (typeof wire !== "number" || !Number.isSafeInteger(wire) || wire < 1) {
		throw new ContractParseError(
			field,
			"a task number of 1 or more for a verified miner",
			wire,
		);
	}
	return wire;
}

/**
 * A miner that is not active earns nothing: stop() and challenge() zero its weights,
 * even though bstar, mult and (while cooling) the bonus fields are left as they were.
 */
function checkEarnsNothing(
	field: string,
	weight: bigint,
	holdsBonus: boolean,
): void {
	if (weight !== 0n) {
		throw new ContractParseError(
			`${field}.weight`,
			"0 for a miner that is not active",
			weight,
		);
	}
	if (holdsBonus) {
		throw new ContractParseError(
			`${field}.holdsBonus`,
			"false for a miner that is not active",
			holdsBonus,
		);
	}
}

/**
 * The valuation's low case uses weightWithoutBonus, so the bonus fields must agree:
 * weight = (bstar + bonus) × mult, and only a verified miner can hold a bonus.
 */
function checkBonus(
	field: string,
	pool: Miner["pool"],
	weight: bigint,
	weightWithoutBonus: bigint,
	holdsBonus: boolean,
): void {
	if (holdsBonus && pool === "unverified") {
		throw new ContractParseError(
			`${field}.holdsBonus`,
			"false for an unverified miner",
			holdsBonus,
		);
	}
	if (holdsBonus && weightWithoutBonus >= weight) {
		throw new ContractParseError(
			`${field}.weightWithoutBonus`,
			`less than the weight (${weight}) for a miner holding the bonus`,
			weightWithoutBonus,
		);
	}
	if (!holdsBonus && weightWithoutBonus !== weight) {
		throw new ContractParseError(
			`${field}.weightWithoutBonus`,
			`equal to the weight (${weight}) for a miner without the bonus`,
			weightWithoutBonus,
		);
	}
}

export function parseMiner(wire: unknown, field: string): Miner {
	const w = parseObject(wire, field);
	const pool = parseOneOf(w.pool, `${field}.pool`, POOLS);
	const weight = parseUint(w.weight, `${field}.weight`);
	const weightWithoutBonus = parseUint(
		w.weightWithoutBonus,
		`${field}.weightWithoutBonus`,
	);
	const holdsBonus = parseBoolean(w.holdsBonus, `${field}.holdsBonus`);
	const status = parseOneOf(w.status, `${field}.status`, STATUSES);
	if (status !== "active") checkEarnsNothing(field, weight, holdsBonus);
	checkBonus(field, pool, weight, weightWithoutBonus, holdsBonus);
	return {
		key: parseHex32(w.key, `${field}.key`),
		processor: parseAddress(w.processor, `${field}.processor`),
		tokenId: parseUint(w.tokenId, `${field}.tokenId`),
		owner: parseAddress(w.owner, `${field}.owner`),
		status,
		pool,
		taskId: parseTaskId(w.taskId, `${field}.taskId`, pool),
		weight,
		weightWithoutBonus,
		holdsBonus,
		miningSince: parseUint(w.miningSince, `${field}.miningSince`),
		readAt: parseBnbRead(w.readAt, `${field}.readAt`),
	};
}
