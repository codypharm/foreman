// Valuation: Foreman's low / base / high estimated value for one miner over one window,
// with every input and where it came from (CLAUDE.md, "No chain data, no number").

import { ContractParseError } from "./errors.ts";
import { parseSourced, type Sourced, serialiseSourced } from "./sourced.ts";
import {
	type Hex32,
	parseCount,
	parseHex32,
	parseObject,
	parseOneOf,
	parseSignedInt,
	parseText,
	parseUint,
	serialiseSignedInt,
	serialiseUint,
} from "./wire.ts";

export type Scenario<T> = { low: T; base: T; high: T };

export interface Valuation {
	minerKey: Hex32;
	pool: "verified" | "unverified";
	/** Unix seconds, [from, to). */
	window: { from: bigint; to: bigint; label: "30d" | "to-2030-halving" };
	/** BEM base units (8 decimals); low ≤ base ≤ high. */
	range: Scenario<bigint>;
	inputs: {
		/** The low case uses the weight without the bonus. */
		minerWeight: Scenario<Sourced<bigint>>;
		networkWeight: Sourced<bigint>;
		/** Network weight growth a day, in parts per million. */
		growthPpm: Scenario<Sourced<bigint>>;
		/** BEM base units a second. */
		emissionRate: Sourced<bigint>;
	};
	model: {
		version: string;
		backtest: "pending" | Backtest;
	};
}

/**
 * How often the model's 30-day range held in the past (docs/decisions/2026-11-24-forecast-backtest.md):
 * for each start date, the range the app would have shown that day against what a verified miner of
 * unchanged weight earned. Neighbouring start dates share most of their days.
 */
export interface Backtest {
	horizonDays: number;
	/** How many start dates were tested. */
	starts: number;
	/** Start dates whose actual output fell between low and high, inclusive. */
	held: number;
	/** 00:00 UTC of the first and last start date, Unix seconds. */
	firstStart: bigint;
	lastStart: bigint;
	/** |base − actual| ÷ actual, in parts per million: the median and the worst. */
	baseErrorMedianPpm: bigint;
	baseErrorWorstPpm: bigint;
	belowLow: number;
	aboveHigh: number;
	/** Where the full table is, and how to rerun it. */
	ref: string;
}

const POOLS = ["verified", "unverified"] as const;
const LABELS = ["30d", "to-2030-halving"] as const;

export function parseValuation(wire: unknown, field: string): Valuation {
	const w = parseObject(wire, field);
	const window = parseObject(w.window, `${field}.window`);
	const from = parseUint(window.from, `${field}.window.from`);
	const to = parseUint(window.to, `${field}.window.to`);
	if (to <= from) {
		throw new ContractParseError(
			`${field}.window`,
			`to after from (${from})`,
			to,
		);
	}
	const range = parseScenario(w.range, `${field}.range`, parseUint);
	checkOrder(range, `${field}.range`, "rising");
	return {
		minerKey: parseHex32(w.minerKey, `${field}.minerKey`),
		pool: parseOneOf(w.pool, `${field}.pool`, POOLS),
		window: {
			from,
			to,
			label: parseOneOf(window.label, `${field}.window.label`, LABELS),
		},
		range,
		inputs: parseValuationInputs(w.inputs, `${field}.inputs`),
		model: parseValuationModel(w.model, `${field}.model`),
	};
}

/** A valuation's inputs, each with its source; shared with `Payback`, which uses the same ones. */
export function parseValuationInputs(
	wire: unknown,
	field: string,
): Valuation["inputs"] {
	const inputs = parseObject(wire, field);
	const minerWeight = parseScenario(
		inputs.minerWeight,
		`${field}.minerWeight`,
		sourcedUint,
	);
	checkOrder(valuesOf(minerWeight), `${field}.minerWeight`, "rising");
	const growthPpm = parseScenario(
		inputs.growthPpm,
		`${field}.growthPpm`,
		sourcedGrowth,
	);
	checkOrder(valuesOf(growthPpm), `${field}.growthPpm`, "falling");
	return {
		minerWeight,
		networkWeight: sourcedUint(inputs.networkWeight, `${field}.networkWeight`),
		growthPpm,
		emissionRate: sourcedUint(inputs.emissionRate, `${field}.emissionRate`),
	};
}

export function parseValuationModel(
	wire: unknown,
	field: string,
): Valuation["model"] {
	const model = parseObject(wire, field);
	return {
		version: parseText(model.version, `${field}.version`),
		backtest: parseBacktest(model.backtest, `${field}.backtest`),
	};
}

/** A valuation for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseValuation(
	valuation: Valuation,
	field: string,
): Record<string, unknown> {
	const { window, range, inputs, model } = valuation;
	const wire = {
		minerKey: valuation.minerKey,
		pool: valuation.pool,
		window: {
			from: serialiseUint(window.from, `${field}.window.from`),
			to: serialiseUint(window.to, `${field}.window.to`),
			label: window.label,
		},
		range: serialiseScenario(range, `${field}.range`, serialiseUint),
		inputs: serialiseValuationInputs(inputs, `${field}.inputs`),
		model: serialiseValuationModel(model, `${field}.model`),
	};
	parseValuation(wire, field);
	return wire;
}

export function serialiseValuationInputs(
	inputs: Valuation["inputs"],
	field: string,
): Record<string, unknown> {
	const uint = (sourced: Sourced<bigint>, at: string) =>
		serialiseSourced(sourced, at, serialiseUint);
	const signed = (sourced: Sourced<bigint>, at: string) =>
		serialiseSourced(sourced, at, serialiseSignedInt);
	return {
		minerWeight: serialiseScenario(
			inputs.minerWeight,
			`${field}.minerWeight`,
			uint,
		),
		networkWeight: uint(inputs.networkWeight, `${field}.networkWeight`),
		growthPpm: serialiseScenario(
			inputs.growthPpm,
			`${field}.growthPpm`,
			signed,
		),
		emissionRate: uint(inputs.emissionRate, `${field}.emissionRate`),
	};
}

export function serialiseScenario<T>(
	scenario: Scenario<T>,
	field: string,
	serialiseValue: (value: T, field: string) => unknown,
): Scenario<unknown> {
	return {
		low: serialiseValue(scenario.low, `${field}.low`),
		base: serialiseValue(scenario.base, `${field}.base`),
		high: serialiseValue(scenario.high, `${field}.high`),
	};
}

/**
 * Low, base and high must be in order, or the screen shows a range that means nothing.
 * Output and miner weight rise from low to high. Network growth falls: the low case
 * assumes the fastest growth, because a bigger network means a smaller share.
 */
function checkOrder(
	scenario: Scenario<bigint>,
	field: string,
	direction: "rising" | "falling",
): void {
	const { low, base, high } = scenario;
	const ordered =
		direction === "rising"
			? low <= base && base <= high
			: low >= base && base >= high;
	if (!ordered) {
		const expected =
			direction === "rising" ? "low ≤ base ≤ high" : "low ≥ base ≥ high";
		throw new ContractParseError(field, expected, `${low} · ${base} · ${high}`);
	}
}

function valuesOf(scenario: Scenario<Sourced<bigint>>): Scenario<bigint> {
	return {
		low: scenario.low.value,
		base: scenario.base.value,
		high: scenario.high.value,
	};
}

/** "pending" until the model is backtested; then how often its range held, and where to read it. */
function parseBacktest(
	wire: unknown,
	field: string,
): Valuation["model"]["backtest"] {
	if (wire === "pending") return "pending";
	if (typeof wire !== "object" || wire === null) {
		throw new ContractParseError(field, '"pending" or a backtest result', wire);
	}
	const w = parseObject(wire, field);
	const result: Backtest = {
		horizonDays: parseCount(w.horizonDays, `${field}.horizonDays`),
		starts: parseCount(w.starts, `${field}.starts`),
		held: parseCount(w.held, `${field}.held`),
		firstStart: parseUint(w.firstStart, `${field}.firstStart`),
		lastStart: parseUint(w.lastStart, `${field}.lastStart`),
		baseErrorMedianPpm: parseUint(
			w.baseErrorMedianPpm,
			`${field}.baseErrorMedianPpm`,
		),
		baseErrorWorstPpm: parseUint(
			w.baseErrorWorstPpm,
			`${field}.baseErrorWorstPpm`,
		),
		belowLow: parseCount(w.belowLow, `${field}.belowLow`),
		aboveHigh: parseCount(w.aboveHigh, `${field}.aboveHigh`),
		ref: parseText(w.ref, `${field}.ref`),
	};
	if (result.starts === 0) {
		throw new ContractParseError(`${field}.starts`, "at least 1", 0);
	}
	if (result.held + result.belowLow + result.aboveHigh !== result.starts) {
		throw new ContractParseError(
			`${field}.held`,
			`held + belowLow + aboveHigh = starts (${result.starts})`,
			`${result.held} + ${result.belowLow} + ${result.aboveHigh}`,
		);
	}
	if (result.lastStart < result.firstStart) {
		throw new ContractParseError(
			`${field}.lastStart`,
			`at or after firstStart (${result.firstStart})`,
			result.lastStart,
		);
	}
	if (result.baseErrorMedianPpm > result.baseErrorWorstPpm) {
		throw new ContractParseError(
			`${field}.baseErrorMedianPpm`,
			`at most baseErrorWorstPpm (${result.baseErrorWorstPpm})`,
			result.baseErrorMedianPpm,
		);
	}
	return result;
}

/** The model's version and backtest for the wire: the backtest's block-sized numbers as strings. */
export function serialiseValuationModel(
	model: Valuation["model"],
	field: string,
): Record<string, unknown> {
	return {
		version: model.version,
		backtest: serialiseBacktest(model.backtest, `${field}.backtest`),
	};
}

function serialiseBacktest(
	backtest: Valuation["model"]["backtest"],
	field: string,
): unknown {
	if (backtest === "pending") return "pending";
	return {
		...backtest,
		firstStart: serialiseUint(backtest.firstStart, `${field}.firstStart`),
		lastStart: serialiseUint(backtest.lastStart, `${field}.lastStart`),
		baseErrorMedianPpm: serialiseUint(
			backtest.baseErrorMedianPpm,
			`${field}.baseErrorMedianPpm`,
		),
		baseErrorWorstPpm: serialiseUint(
			backtest.baseErrorWorstPpm,
			`${field}.baseErrorWorstPpm`,
		),
	};
}

/** Parts per million a day. Negative means the network shrinks; -100% or less is impossible. */
function parseGrowthPpm(wire: unknown, field: string): bigint {
	const ppm = parseSignedInt(wire, field);
	if (ppm <= -1_000_000n) {
		throw new ContractParseError(
			field,
			"above -1,000,000 ppm (-100% a day)",
			ppm,
		);
	}
	return ppm;
}

function sourcedGrowth(wire: unknown, field: string): Sourced<bigint> {
	return parseSourced(wire, field, parseGrowthPpm);
}

function sourcedUint(wire: unknown, field: string): Sourced<bigint> {
	return parseSourced(wire, field, parseUint);
}

export function parseScenario<T>(
	wire: unknown,
	field: string,
	parseValue: (wire: unknown, field: string) => T,
): Scenario<T> {
	const w = parseObject(wire, field);
	return {
		low: parseValue(w.low, `${field}.low`),
		base: parseValue(w.base, `${field}.base`),
		high: parseValue(w.high, `${field}.high`),
	};
}
