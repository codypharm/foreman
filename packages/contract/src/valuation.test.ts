import { describe, expect, test } from "vitest";
import { parseValuation, serialiseValuation } from "./index.ts";

// The miner page mock's valuation: 11.08 · 51.69 · 54.73 BEM over 30 days
const KEY =
	"0x3f9a00000000000000000000000000000000000000000000000000000000c21e";
const AT_BLOCK = { source: "chain", chainId: 56, block: "134351215" };
const GROWTH = "growth measured over the last 14 days";

function wireValuation(overrides: Record<string, unknown> = {}) {
	return {
		minerKey: KEY,
		pool: "verified",
		window: { from: "1795000000", to: "1797592000", label: "30d" },
		range: { low: "1108000000", base: "5169000000", high: "5473000000" },
		inputs: {
			minerWeight: {
				low: { value: "96", ...AT_BLOCK },
				base: { value: "412", ...AT_BLOCK },
				high: { value: "412", ...AT_BLOCK },
			},
			networkWeight: { value: "1609667", ...AT_BLOCK },
			growthPpm: {
				low: { value: "10000", source: "assumption", basis: GROWTH },
				base: { value: "4000", source: "assumption", basis: GROWTH },
				high: { value: "0", source: "assumption", basis: GROWTH },
			},
			emissionRate: {
				value: "8333333",
				source: "constant",
				ref: "PodMining.INITIAL_RATE",
			},
		},
		model: { version: "v0.1", backtest: "pending" },
		...overrides,
	};
}

const chain = (value: bigint) => ({
	value,
	source: "chain",
	chainId: 56,
	block: 134_351_215n,
});
const assumed = (value: bigint) => ({
	value,
	source: "assumption",
	basis: GROWTH,
});

describe("a valuation on the wire", () => {
	test("parses to the contract's Valuation, every input with its source", () => {
		expect(parseValuation(wireValuation(), "valuation")).toEqual({
			minerKey: KEY,
			pool: "verified",
			window: { from: 1_795_000_000n, to: 1_797_592_000n, label: "30d" },
			range: {
				low: 1_108_000_000n,
				base: 5_169_000_000n,
				high: 5_473_000_000n,
			},
			inputs: {
				minerWeight: { low: chain(96n), base: chain(412n), high: chain(412n) },
				networkWeight: chain(1_609_667n),
				growthPpm: {
					low: assumed(10_000n),
					base: assumed(4_000n),
					high: assumed(0n),
				},
				emissionRate: {
					value: 8_333_333n,
					source: "constant",
					ref: "PodMining.INITIAL_RATE",
				},
			},
			model: { version: "v0.1", backtest: "pending" },
		});
	});
});

const inputs = wireValuation().inputs;

describe("a valuation written to the wire", () => {
	test.each([
		["as the miner page mock shows it", wireValuation()],
		[
			"with a shrinking network and a published backtest",
			wireValuation({
				window: {
					from: "1795000000",
					to: "1913577332",
					label: "to-2030-halving",
				},
				inputs: {
					...wireValuation().inputs,
					growthPpm: {
						low: { value: "10000", source: "assumption", basis: GROWTH },
						base: { value: "0", source: "assumption", basis: GROWTH },
						high: { value: "-2000", source: "assumption", basis: GROWTH },
					},
				},
				model: {
					version: "v0.2",
					backtest: { coverage: "27 of 30 days", ref: "README#backtests" },
				},
			}),
		],
	])("reads back unchanged: %s", (_name, wire) => {
		const valuation = parseValuation(wire, "valuation");
		const sent = JSON.parse(
			JSON.stringify(serialiseValuation(valuation, "valuation")),
		);
		expect(sent).toEqual(wire);
		expect(parseValuation(sent, "valuation")).toEqual(valuation);
	});
});

describe("a valuation's backtest", () => {
	test("once published, says how often the range held and where to read it", () => {
		const backtest = {
			coverage: "actual output inside the range for 27 of 30 days",
			ref: "README#backtests",
		};
		const valuation = parseValuation(
			wireValuation({ model: { version: "v0.2", backtest } }),
			"valuation",
		);
		expect(valuation.model.backtest).toEqual(backtest);
	});

	test.each([
		["done", "a word that is not pending"],
		[{ coverage: "27 of 30 days" }, "a result with nowhere to read it"],
		[{ coverage: "", ref: "README#backtests" }, "a result with no coverage"],
		[undefined, "missing"],
	])("is refused when %j: %s", (backtest, _why) => {
		expect(() =>
			parseValuation(
				wireValuation({ model: { version: "v0.1", backtest } }),
				"valuation",
			),
		).toThrow(
			expect.objectContaining({
				name: "ContractParseError",
				field: expect.stringMatching(/^valuation\.model\.backtest/),
			}),
		);
	});
});

describe("a valuation out of order", () => {
	test.each([
		[
			{ range: { low: "5169000001", base: "5169000000", high: "5473000000" } },
			"valuation.range",
			"low above base",
		],
		[
			{ range: { low: "1108000000", base: "5473000001", high: "5473000000" } },
			"valuation.range",
			"base above high",
		],
		[
			{
				inputs: {
					...inputs,
					minerWeight: {
						...inputs.minerWeight,
						low: { value: "500", ...AT_BLOCK },
					},
				},
			},
			"valuation.inputs.minerWeight",
			"low-case weight above base: the low case can only lose the bonus",
		],
		[
			{
				inputs: {
					...inputs,
					growthPpm: {
						...inputs.growthPpm,
						low: { value: "1000", source: "assumption", basis: GROWTH },
					},
				},
			},
			"valuation.inputs.growthPpm",
			"low case assumes slower growth than base: faster growth is what makes it low",
		],
		[
			{ window: { from: "1797592000", to: "1797592000", label: "30d" } },
			"valuation.window",
			"a window that ends when it starts",
		],
	])("%j is refused at %s: %s", (overrides, field, _why) => {
		expect(() => parseValuation(wireValuation(overrides), "valuation")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});

	test("may assume the network shrinks in the high case", () => {
		const growthPpm = {
			...inputs.growthPpm,
			high: { value: "-2000", source: "assumption", basis: GROWTH },
		};
		const valuation = parseValuation(
			wireValuation({ inputs: { ...inputs, growthPpm } }),
			"valuation",
		);
		expect(valuation.inputs.growthPpm.high.value).toBe(-2_000n);
	});

	test.each([
		["-1000000", "the whole network gone in a day"],
		["-0", "minus zero: zero has one spelling"],
		["--5", "not a number"],
	])("refuses growth of %s: %s", (value, _why) => {
		const growthPpm = {
			...inputs.growthPpm,
			high: { value, source: "assumption", basis: GROWTH },
		};
		expect(() =>
			parseValuation(
				wireValuation({ inputs: { ...inputs, growthPpm } }),
				"valuation",
			),
		).toThrow(
			expect.objectContaining({
				name: "ContractParseError",
				field: "valuation.inputs.growthPpm.high.value",
			}),
		);
	});

	test("with all three cases equal is fine: nothing to separate them yet", () => {
		const flat = { low: "5169000000", base: "5169000000", high: "5169000000" };
		expect(parseValuation(wireValuation({ range: flat }), "v").range.low).toBe(
			5_169_000_000n,
		);
	});
});
