// Originality: one circuit's verdict with its evidence, rule version and block. Shapes exactly as
// in docs/data-contract.md ("CircuitRef", "Originality"; provisional). Rules:
// docs/decisions/2026-11-20-copy-and-wrapper-rules.md and the records that amend it. The parser
// refuses a result the data contract's rules say can't exist; the results contract logs this JSON
// (docs/decisions/2026-11-21-results-contract.md).

import { ContractParseError } from "./errors.ts";
import type { ChainId } from "./sourced.ts";
import {
	type Address,
	type Hex32,
	parseAddress,
	parseBoolean,
	parseCount,
	parseHex32,
	parseObject,
	parseOneOf,
	parseText,
	parseUint,
	serialiseUint,
} from "./wire.ts";

export interface CircuitRef {
	chainId: 56 | 196;
	/** The processor contract (the circuit's NFT collection). */
	processor: Address;
	/** The circuit's id on that processor. */
	tokenId: bigint;
	/** Position in the chain, and the block's time (Unix seconds). */
	tapedOutAt: {
		block: bigint;
		txIndex: number;
		logIndex: number;
		time: bigint;
	};
	/** The owner in the processor's TapedOut event. */
	tapedOutBy: Address;
	/** The design commitment the mining contract accepted, and its block's time; only miners can have one. */
	designCommittedAt: { block: bigint; time: bigint } | null;
}

export type OriginalityVerdict =
	/** Netlist is only REF records. chainSteps counts the longest branch, at most 10. */
	| {
			verdict: "wrapper";
			pointsTo: CircuitRef[];
			finalTargets: CircuitRef[];
			chainSteps: number;
	  }
	/** Same netlist hash as a circuit with an earlier design time, at or above the size floor. */
	| {
			verdict: "copy";
			of: CircuitRef;
			netlistHash: Hex32;
			/** false when they match only once NAND inputs are sorted. */
			bytesIdentical: boolean;
			/** What made `of` earlier. */
			earlierBy: "tape-out" | "commitment";
	  }
	/** Identical, below the size floor. */
	| {
			verdict: "too-small-to-tell";
			sameAs: number;
			earliest: CircuitRef;
			netlistHash: Hex32;
			gateCount: number;
			floor: number;
	  }
	| { verdict: "no-earlier-copy"; netlistHash: Hex32 }
	| {
			verdict: "cant-check";
			reason:
				| "netlist-unreadable"
				| "outside-index"
				| "read-failed"
				| "ref-chain-too-long"
				/** Counting a FabX commitment without its event would change the result, on either chain (2026-11-25-cross-chain-check.md, decision 1). */
				| "commitment-unconfirmed";
	  };

export type CantMineReason =
	/** processorMultiplier is 0. */
	| { reason: "processor-not-eligible" }
	/** The netlist has a REF record. */
	| { reason: "uses-ref" }
	/** Revoked, from the Revoked event; it can never start again. */
	| {
			reason: "failed-test-vector";
			taskId: number;
			vectorIndex: number;
			block: bigint;
	  };

export type OriginalityFact =
	/** Beside "copy": the earlier circuit was taped out by the same address, or not. */
	| { fact: "tape-out-address"; same: boolean }
	/** REF records mixed with real gates. */
	| {
			fact: "uses-ref";
			refRecords: number;
			targets: CircuitRef[];
			borrowedGates: number;
			totalGates: number;
	  }
	/** Beside "wrapper": also identical to an earlier circuit. */
	| { fact: "also-identical"; to: CircuitRef; netlistHash: Hex32 }
	/** Every result carries exactly one can-mine fact. */
	| { fact: "can-mine"; state: "mining" }
	| { fact: "can-mine"; state: "cant-mine"; reasons: CantMineReason[] }
	/** Cooling: stopBlock, and stopBlock + 1,200. */
	| {
			fact: "can-mine";
			state: "stopped";
			stoppedAt: bigint;
			canStartFrom: bigint;
	  }
	/** Nothing rules it out; never a promise that it passes a task. */
	| { fact: "can-mine"; state: "not-started" }
	/** Miners only, from getMiner (optimal, bonus); shown before the verdict. */
	| { fact: "design-bonus"; holds: boolean; bonus: bigint }
	/** Miners in the index with the same netlist hash, this one included; only when 2 or more. */
	| { fact: "design-shared"; miners: number };

export interface Originality {
	circuit: CircuitRef;
	/** Why it was checked; only "miner" and "listed" are published. */
	scope: "miner" | "listed" | "pasted";
	/**
	 * The mining contract a miner is registered in, on the circuit's chain (TapeOut's PoD on 56,
	 * FabX's on 196); null for a circuit that isn't a miner. Named on screen from On-chain facts.
	 */
	mining: { chainId: ChainId; contract: Address } | null;
	result: OriginalityVerdict;
	facts: OriginalityFact[];
	occc:
		| { status: "official"; collection: Address }
		| { status: "not-listed" }
		| { status: "not-checked" };
	index: OriginalityIndex;
	/** Every setting that can change the result, spelled out: "hash 2026-11-20, floor 4, chain 10". */
	ruleVersion: string;
}

/** Coverage: one entry per chain checked, BNB Chain first. */
export interface OriginalityIndex {
	circuitsChecked: bigint;
	upTo: { chainId: ChainId; block: bigint }[];
}

/** A stopped miner can start again this many blocks after its stop block (the mining contract's cooldown). */
export const STOP_COOLDOWN_BLOCKS = 1_200n;
/** The longest wrapper chain followed (2026-11-20-wrapper-targets-and-step-limit.md). */
export const WRAPPER_STEP_LIMIT = 10;

export function parseOriginality(wire: unknown, field: string): Originality {
	const w = parseObject(wire, field);
	const circuit = parseCircuitRef(w.circuit, `${field}.circuit`);
	const scope = parseOneOf(w.scope, `${field}.scope`, [
		"miner",
		"listed",
		"pasted",
	] as const);
	const mining = parseMining(w.mining, `${field}.mining`, scope, circuit);
	const result = parseVerdict(w.result, `${field}.result`, circuit);
	if (scope === "miner" && result.verdict === "wrapper") {
		// A miner can't have a REF record: the mining contract's start reverts
		throw new ContractParseError(
			`${field}.result`,
			"no wrapper for a miner (a miner can't have REF records)",
			result.verdict,
		);
	}
	const facts = parseFacts(w.facts, `${field}.facts`, scope, circuit, mining);
	const index = parseOriginalityIndex(w.index, `${field}.index`);
	if (
		result.verdict === "cant-check" &&
		result.reason === "commitment-unconfirmed" &&
		indexBlock(index, 196) === null
	) {
		// Only FabX's commitments go unconfirmed, so the result checked X Layer (2026-11-25-cross-chain-check.md, decision 1)
		throw new ContractParseError(
			`${field}.result.reason`,
			"an unconfirmed commitment only where X Layer was checked",
			result.reason,
		);
	}
	if (!index.upTo.some((u) => u.chainId === circuit.chainId)) {
		throw new ContractParseError(
			`${field}.index.upTo`,
			`an entry for the circuit's own chain (${circuit.chainId})`,
			index.upTo.map((u) => u.chainId),
		);
	}
	return {
		circuit,
		scope,
		mining,
		result,
		facts,
		occc: parseOccc(w.occc, `${field}.occc`),
		index,
		ruleVersion: parseText(w.ruleVersion, `${field}.ruleVersion`),
	};
}

/** Coverage: at least one circuit, BNB Chain first, each chain once. */
export function parseOriginalityIndex(
	wire: unknown,
	field: string,
): OriginalityIndex {
	const w = parseObject(wire, field);
	const circuitsChecked = parseUint(
		w.circuitsChecked,
		`${field}.circuitsChecked`,
	);
	if (circuitsChecked === 0n) {
		throw new ContractParseError(
			`${field}.circuitsChecked`,
			"at least one circuit checked",
			circuitsChecked,
		);
	}
	if (!Array.isArray(w.upTo)) {
		throw new ContractParseError(`${field}.upTo`, "a list of chains", w.upTo);
	}
	const upTo = w.upTo.map((u, i) => {
		const e = parseObject(u, `${field}.upTo[${i}]`);
		return {
			chainId: parseChain(e.chainId, `${field}.upTo[${i}].chainId`),
			block: parseUint(e.block, `${field}.upTo[${i}].block`),
		};
	});
	const chains = upTo.map((u) => u.chainId);
	const expected = [56, 196];
	if (
		chains.length < 1 ||
		chains.length > 2 ||
		chains.some((c, i) => c !== expected[i])
	) {
		throw new ContractParseError(
			`${field}.upTo`,
			"BNB Chain (56), then X Layer (196) when it was checked, each once",
			chains,
		);
	}
	return { circuitsChecked, upTo };
}

/** The block an index was read up to on one chain, or null when it didn't check that chain. */
export function indexBlock(
	index: OriginalityIndex,
	chainId: ChainId,
): bigint | null {
	return index.upTo.find((u) => u.chainId === chainId)?.block ?? null;
}

/** The BNB Chain block an index was read up to: every parsed index states it, first. */
export function bnbIndexBlock(index: OriginalityIndex): bigint {
	const block = indexBlock(index, 56);
	if (block === null)
		throw new Error("an index states its BNB Chain block first");
	return block;
}

/** An Originality for the wire. Parses its own output, so it never sends what a reader would refuse. */
export function serialiseOriginality(
	originality: Originality,
	field: string,
): Record<string, unknown> {
	const wire = toWire(originality, field) as Record<string, unknown>;
	parseOriginality(wire, field);
	return wire;
}

export function parseCircuitRef(wire: unknown, field: string): CircuitRef {
	const w = parseObject(wire, field);
	const at = parseObject(w.tapedOutAt, `${field}.tapedOutAt`);
	let designCommittedAt: CircuitRef["designCommittedAt"] = null;
	if (w.designCommittedAt !== null) {
		const c = parseObject(w.designCommittedAt, `${field}.designCommittedAt`);
		designCommittedAt = {
			block: parseUint(c.block, `${field}.designCommittedAt.block`),
			time: parseUint(c.time, `${field}.designCommittedAt.time`),
		};
	}
	return {
		chainId: parseChain(w.chainId, `${field}.chainId`),
		processor: parseAddress(w.processor, `${field}.processor`),
		tokenId: parseUint(w.tokenId, `${field}.tokenId`),
		tapedOutAt: {
			block: parseUint(at.block, `${field}.tapedOutAt.block`),
			txIndex: parseCount(at.txIndex, `${field}.tapedOutAt.txIndex`),
			logIndex: parseCount(at.logIndex, `${field}.tapedOutAt.logIndex`),
			time: parseUint(at.time, `${field}.tapedOutAt.time`),
		},
		tapedOutBy: parseAddress(w.tapedOutBy, `${field}.tapedOutBy`),
		designCommittedAt,
	};
}

/**
 * True when `a` has the earlier design time: its accepted commitment block if that is before its
 * tape-out, otherwise its tape-out block; same block, the lower tape-out position is earlier
 * (2026-11-20-verdict-scope-and-earliest-design.md, decision 4). Across chains, design times are
 * compared in Unix seconds, and the same second is earlier on neither
 * (2026-11-25-fabx-copy-check.md, decision 4).
 */
export function designedEarlier(a: CircuitRef, b: CircuitRef): boolean {
	if (a.chainId !== b.chainId) return designSecond(a) < designSecond(b);
	const da = designTime(a);
	const db = designTime(b);
	if (da !== db) return da < db;
	const x = a.tapedOutAt;
	const y = b.tapedOutAt;
	if (x.block !== y.block) return x.block < y.block;
	if (x.txIndex !== y.txIndex) return x.txIndex < y.txIndex;
	return x.logIndex < y.logIndex;
}

function designTime(c: CircuitRef): bigint {
	const committed = c.designCommittedAt?.block;
	return committed !== undefined && committed < c.tapedOutAt.block
		? committed
		: c.tapedOutAt.block;
}

/** The Unix second of the design block: its own block's timestamp. */
function designSecond(c: CircuitRef): bigint {
	const committed = c.designCommittedAt;
	return committed && committed.block < c.tapedOutAt.block
		? committed.time
		: c.tapedOutAt.time;
}

function parseMining(
	wire: unknown,
	field: string,
	scope: Originality["scope"],
	circuit: CircuitRef,
): Originality["mining"] {
	if (wire === null) {
		if (scope === "miner") {
			throw new ContractParseError(field, "a miner's mining contract", wire);
		}
		return null;
	}
	const w = parseObject(wire, field);
	const chainId = parseChain(w.chainId, `${field}.chainId`);
	if (chainId !== circuit.chainId) {
		throw new ContractParseError(
			`${field}.chainId`,
			`the circuit's own chain (${circuit.chainId})`,
			chainId,
		);
	}
	return { chainId, contract: parseAddress(w.contract, `${field}.contract`) };
}

function parseVerdict(
	wire: unknown,
	field: string,
	circuit: CircuitRef,
): OriginalityVerdict {
	const w = parseObject(wire, field);
	const verdict = parseOneOf(w.verdict, `${field}.verdict`, [
		"wrapper",
		"copy",
		"too-small-to-tell",
		"no-earlier-copy",
		"cant-check",
	] as const);
	switch (verdict) {
		case "wrapper": {
			const chainSteps = parseCount(w.chainSteps, `${field}.chainSteps`);
			if (chainSteps < 1 || chainSteps > WRAPPER_STEP_LIMIT) {
				throw new ContractParseError(
					`${field}.chainSteps`,
					`1 to ${WRAPPER_STEP_LIMIT} steps`,
					chainSteps,
				);
			}
			return {
				verdict,
				pointsTo: parseRefs(w.pointsTo, `${field}.pointsTo`),
				finalTargets: parseRefs(w.finalTargets, `${field}.finalTargets`),
				chainSteps,
			};
		}
		case "copy":
			return {
				verdict,
				of: parseEarlier(w.of, `${field}.of`, circuit),
				netlistHash: parseHex32(w.netlistHash, `${field}.netlistHash`),
				bytesIdentical: parseBoolean(
					w.bytesIdentical,
					`${field}.bytesIdentical`,
				),
				earlierBy: parseOneOf(w.earlierBy, `${field}.earlierBy`, [
					"tape-out",
					"commitment",
				] as const),
			};
		case "too-small-to-tell": {
			const gateCount = parseCount(w.gateCount, `${field}.gateCount`);
			const floor = parseCount(w.floor, `${field}.floor`);
			if (gateCount >= floor) {
				throw new ContractParseError(
					`${field}.gateCount`,
					`fewer gates than the floor (${floor})`,
					gateCount,
				);
			}
			const sameAs = parseCount(w.sameAs, `${field}.sameAs`);
			if (sameAs < 1) {
				throw new ContractParseError(
					`${field}.sameAs`,
					"at least one earlier circuit",
					sameAs,
				);
			}
			return {
				verdict,
				sameAs,
				earliest: parseEarlier(w.earliest, `${field}.earliest`, circuit),
				netlistHash: parseHex32(w.netlistHash, `${field}.netlistHash`),
				gateCount,
				floor,
			};
		}
		case "no-earlier-copy":
			return {
				verdict,
				netlistHash: parseHex32(w.netlistHash, `${field}.netlistHash`),
			};
		case "cant-check":
			return {
				verdict,
				reason: parseOneOf(w.reason, `${field}.reason`, [
					"netlist-unreadable",
					"outside-index",
					"read-failed",
					"ref-chain-too-long",
					"commitment-unconfirmed",
				] as const),
			};
	}
}

function parseFacts(
	wire: unknown,
	field: string,
	scope: Originality["scope"],
	circuit: CircuitRef,
	mining: Originality["mining"],
): OriginalityFact[] {
	if (!Array.isArray(wire)) throw new ContractParseError(field, "a list", wire);
	const fabx = mining?.chainId === 196;
	const facts = wire.map((f, i) =>
		parseFact(f, `${field}[${i}]`, scope, circuit, fabx),
	);
	const canMine = facts.filter((f) => f.fact === "can-mine").length;
	if (canMine !== 1) {
		throw new ContractParseError(field, "exactly one can-mine fact", canMine);
	}
	return facts;
}

function parseFact(
	wire: unknown,
	field: string,
	scope: Originality["scope"],
	circuit: CircuitRef,
	fabx: boolean,
): OriginalityFact {
	const w = parseObject(wire, field);
	const fact = parseOneOf(w.fact, `${field}.fact`, [
		"tape-out-address",
		"uses-ref",
		"also-identical",
		"can-mine",
		"design-bonus",
		"design-shared",
	] as const);
	if (fact === "design-bonus" && scope !== "miner") {
		throw new ContractParseError(
			field,
			"a design bonus on a miner only",
			scope,
		);
	}
	if (fact === "design-bonus" && fabx) {
		// Its meaning in FabX's unverified code is an assumption (2026-11-25-fabx-copy-check.md, decision 10)
		throw new ContractParseError(
			field,
			"no design bonus on a FabX miner",
			fact,
		);
	}
	if (fact === "uses-ref" && scope === "miner") {
		throw new ContractParseError(
			field,
			"no REF records on a miner (a miner can't have them)",
			scope,
		);
	}
	switch (fact) {
		case "tape-out-address":
			return { fact, same: parseBoolean(w.same, `${field}.same`) };
		case "uses-ref":
			return {
				fact,
				refRecords: parseCount(w.refRecords, `${field}.refRecords`),
				targets: parseRefs(w.targets, `${field}.targets`),
				borrowedGates: parseCount(w.borrowedGates, `${field}.borrowedGates`),
				totalGates: parseCount(w.totalGates, `${field}.totalGates`),
			};
		case "also-identical":
			return {
				fact,
				to: parseEarlier(w.to, `${field}.to`, circuit),
				netlistHash: parseHex32(w.netlistHash, `${field}.netlistHash`),
			};
		case "can-mine":
			return parseCanMine(w, field, fabx);
		case "design-bonus":
			return {
				fact,
				holds: parseBoolean(w.holds, `${field}.holds`),
				bonus: parseUint(w.bonus, `${field}.bonus`),
			};
		case "design-shared": {
			const miners = parseCount(w.miners, `${field}.miners`);
			if (miners < 2) {
				throw new ContractParseError(
					`${field}.miners`,
					"2 or more miners, this one included",
					miners,
				);
			}
			return { fact, miners };
		}
	}
}

function parseCanMine(
	w: Record<string, unknown>,
	field: string,
	fabx: boolean,
): Extract<OriginalityFact, { fact: "can-mine" }> {
	const state = parseOneOf(w.state, `${field}.state`, [
		"mining",
		"cant-mine",
		"stopped",
		"not-started",
	] as const);
	switch (state) {
		case "mining":
		case "not-started":
			return { fact: "can-mine", state };
		case "cant-mine": {
			if (!Array.isArray(w.reasons) || w.reasons.length === 0) {
				throw new ContractParseError(
					`${field}.reasons`,
					"every reason that applies, at least one",
					w.reasons,
				);
			}
			return {
				fact: "can-mine",
				state,
				reasons: w.reasons.map((r, i) => {
					const reason = parseCantMineReason(r, `${field}.reasons[${i}]`);
					if (fabx && reason.reason === "failed-test-vector") {
						// FabX's tasks aren't read (2026-11-25-fabx-copy-check.md, decision 10)
						throw new ContractParseError(
							`${field}.reasons[${i}]`,
							"no failed test vector on a FabX miner",
							reason.reason,
						);
					}
					return reason;
				}),
			};
		}
		case "stopped": {
			const stoppedAt = parseUint(w.stoppedAt, `${field}.stoppedAt`);
			const canStartFrom = parseUint(w.canStartFrom, `${field}.canStartFrom`);
			if (canStartFrom !== stoppedAt + STOP_COOLDOWN_BLOCKS) {
				throw new ContractParseError(
					`${field}.canStartFrom`,
					`the stop block + ${STOP_COOLDOWN_BLOCKS}`,
					canStartFrom,
				);
			}
			return { fact: "can-mine", state, stoppedAt, canStartFrom };
		}
	}
}

function parseCantMineReason(wire: unknown, field: string): CantMineReason {
	const w = parseObject(wire, field);
	const reason = parseOneOf(w.reason, `${field}.reason`, [
		"processor-not-eligible",
		"uses-ref",
		"failed-test-vector",
	] as const);
	if (reason !== "failed-test-vector") return { reason };
	return {
		reason,
		taskId: parseCount(w.taskId, `${field}.taskId`),
		vectorIndex: parseCount(w.vectorIndex, `${field}.vectorIndex`),
		block: parseUint(w.block, `${field}.block`),
	};
}

function parseOccc(wire: unknown, field: string): Originality["occc"] {
	const w = parseObject(wire, field);
	const status = parseOneOf(w.status, `${field}.status`, [
		"official",
		"not-listed",
		"not-checked",
	] as const);
	return status === "official"
		? { status, collection: parseAddress(w.collection, `${field}.collection`) }
		: { status };
}

/** A circuit that must have an earlier design time than `circuit`: the earliest is never called a copy. */
function parseEarlier(
	wire: unknown,
	field: string,
	circuit: CircuitRef,
): CircuitRef {
	const ref = parseCircuitRef(wire, field);
	if (!designedEarlier(ref, circuit)) {
		throw new ContractParseError(
			field,
			"a circuit with an earlier design time than this one",
			ref.tokenId,
		);
	}
	return ref;
}

function parseRefs(wire: unknown, field: string): CircuitRef[] {
	if (!Array.isArray(wire) || wire.length === 0) {
		throw new ContractParseError(field, "a list of at least one circuit", wire);
	}
	return wire.map((r, i) => parseCircuitRef(r, `${field}[${i}]`));
}

function parseChain(wire: unknown, field: string): ChainId {
	if (wire !== 56 && wire !== 196) {
		throw new ContractParseError(field, "56 or 196", wire);
	}
	return wire;
}

/** bigints become decimal strings; everything else is already the wire shape. */
function toWire(value: unknown, field: string): unknown {
	if (typeof value === "bigint") return serialiseUint(value, field);
	if (Array.isArray(value)) return value.map((v) => toWire(v, field));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, toWire(v, field)]),
		);
	}
	return value;
}
