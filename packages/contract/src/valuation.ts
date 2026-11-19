// Valuation: Foreman's low / base / high estimated value for one miner over one window,
// with every input and where it came from (CLAUDE.md, "No chain data, no number").

import { ContractParseError } from "./errors.ts";
import { parseSourced, type Sourced, serialiseSourced } from "./sourced.ts";
import {
	type Hex32,
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
		backtest: "pending" | { coverage: string; ref: string };
	};
}

const POOLS = ["verified", "unverified"] as const;
const LABELS = ["30d", "to-2030-halving"] as const;

export function parseValuation(wire: unknown, field: string): Valuation {
	const w = parseObject(wire, field);
	const window = parseObject(w.window, `${field}.window`);
	const inputs = parseObject(w.inputs, `${field}.inputs`);
	const model = parseObject(w.model, `${field}.model`);
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
	const minerWeight = parseScenario(
		inputs.minerWeight,
		`${field}.inputs.minerWeight`,
		sourcedUint,
	);
	checkOrder(valuesOf(minerWeight), `${field}.inputs.minerWeight`, "rising");
	const growthPpm = parseScenario(
		inputs.growthPpm,
		`${field}.inputs.growthPpm`,
		sourcedGrowth,
	);
	checkOrder(valuesOf(growthPpm), `${field}.inputs.growthPpm`, "falling");
	return {
		minerKey: parseHex32(w.minerKey, `${field}.minerKey`),
		pool: parseOneOf(w.pool, `${field}.pool`, POOLS),
		window: {
			from,
			to,
			label: parseOneOf(window.label, `${field}.window.label`, LABELS),
		},
		range,
		inputs: {
			minerWeight,
			networkWeight: sourcedUint(
				inputs.networkWeight,
				`${field}.inputs.networkWeight`,
			),
			growthPpm,
			emissionRate: sourcedUint(
				inputs.emissionRate,
				`${field}.inputs.emissionRate`,
			),
		},
		model: {
			version: parseText(model.version, `${field}.model.version`),
			backtest: parseBacktest(model.backtest, `${field}.model.backtest`),
		},
	};
}

/** A valuation for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseValuation(
	valuation: Valuation,
	field: string,
): Record<string, unknown> {
	const { window, range, inputs, model } = valuation;
	const uint = (sourced: Sourced<bigint>, at: string) =>
		serialiseSourced(sourced, at, serialiseUint);
	const signed = (sourced: Sourced<bigint>, at: string) =>
		serialiseSourced(sourced, at, serialiseSignedInt);
	const wire = {
		minerKey: valuation.minerKey,
		pool: valuation.pool,
		window: {
			from: serialiseUint(window.from, `${field}.window.from`),
			to: serialiseUint(window.to, `${field}.window.to`),
			label: window.label,
		},
		range: serialiseScenario(range, `${field}.range`, serialiseUint),
		inputs: {
			minerWeight: serialiseScenario(
				inputs.minerWeight,
				`${field}.inputs.minerWeight`,
				uint,
			),
			networkWeight: uint(
				inputs.networkWeight,
				`${field}.inputs.networkWeight`,
			),
			growthPpm: serialiseScenario(
				inputs.growthPpm,
				`${field}.inputs.growthPpm`,
				signed,
			),
			emissionRate: uint(inputs.emissionRate, `${field}.inputs.emissionRate`),
		},
		model: { version: model.version, backtest: model.backtest },
	};
	parseValuation(wire, field);
	return wire;
}

function serialiseScenario<T>(
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

/** "pending" until a backtest is published; then how often the range held, and where to read it. */
function parseBacktest(
	wire: unknown,
	field: string,
): Valuation["model"]["backtest"] {
	if (wire === "pending") return "pending";
	if (typeof wire !== "object" || wire === null) {
		throw new ContractParseError(
			field,
			'"pending" or a published result',
			wire,
		);
	}
	const w = parseObject(wire, field);
	return {
		coverage: parseText(w.coverage, `${field}.coverage`),
		ref: parseText(w.ref, `${field}.ref`),
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

function parseScenario<T>(
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
