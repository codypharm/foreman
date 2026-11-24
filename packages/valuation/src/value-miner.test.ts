import {
	type BnbRead,
	type Miner,
	type NetworkState,
	parseAddress,
	parseHex32,
} from "@foreman/contract";
import { describe, expect, test } from "vitest";
import recorded from "../fixtures/network-daily-20261021-20261120.json" with {
	type: "json",
};
import {
	BACKTEST_RESULT,
	type DailySample,
	FIRST_HALVING,
	MODEL_VERSION,
	outputRange,
	valueMiner,
} from "./index.ts";

// A Valuation from chain reads: the miner and the network at one block, and the growth rates from
// the daily samples (docs/decisions/2026-11-18-valuation-model.md, 2026-11-20-growth-rates.md,
// 2026-11-24-high-case-no-growth.md).
// The miner and network figures are made up but realistic; the samples are real. The rule's
// arithmetic is tested in growth.test.ts and range.test.ts; this checks what goes where.

const READ_AT: BnbRead = {
	chainId: 56,
	block: 134_739_204n,
	time: 1_795_197_496n,
};
const DAYS: DailySample[] = recorded.samples.map((s) => ({
	time: BigInt(s.time),
	block: BigInt(s.block),
	verifiedWeight: BigInt(s.verifiedWeight),
}));
const KEY = parseHex32(`0x${"ab".repeat(32)}`, "key");
const MINER: Miner = {
	key: KEY,
	processor: parseAddress("0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c", "p"),
	tokenId: 7n,
	owner: parseAddress(`0x${"12".repeat(20)}`, "owner"),
	status: "active",
	pool: "verified",
	taskId: 4,
	weight: 412n,
	weightWithoutBonus: 96n,
	holdsBonus: true,
	miningSince: 1_795_000_000n,
	readAt: READ_AT,
};
const NETWORK: NetworkState = {
	verifiedWeight: 1_614_500n,
	unverifiedWeight: 41_300n,
	minerCount: 20_850n,
	verifiedMinerCount: 20_200n,
	readAt: READ_AT,
};
const chain = (value: bigint) => ({
	value,
	source: "chain",
	chainId: 56,
	block: READ_AT.block,
});

describe("valuing a miner from chain reads", () => {
	test("30 days: the miner's weight, the network, the growth rates and the emission, each with its source", () => {
		const valuation = valueMiner({
			miner: MINER,
			network: NETWORK,
			days: DAYS,
			window: "30d",
		});
		const to = READ_AT.time + 30n * 86_400n;
		expect(valuation).toEqual({
			minerKey: KEY,
			pool: "verified",
			window: { from: READ_AT.time, to, label: "30d" },
			range: outputRange({
				minerWeight: 412n,
				weightWithoutBonus: 96n,
				networkWeight: 1_614_500n,
				growth: { fast: 1_873n, expected: 684n, slow: 0n },
				from: READ_AT.time,
				to,
			}),
			inputs: {
				// The low case loses the design bonus
				minerWeight: { low: chain(96n), base: chain(412n), high: chain(412n) },
				networkWeight: chain(1_614_500n),
				growthPpm: {
					low: expect.objectContaining({ value: 1_873n, source: "assumption" }),
					base: expect.objectContaining({ value: 684n, source: "assumption" }),
					high: expect.objectContaining({ value: 0n, source: "assumption" }),
				},
				emissionRate: {
					value: 8_333_333n,
					source: "constant",
					ref: "PodMining.INITIAL_RATE",
				},
			},
			model: {
				version: MODEL_VERSION,
				backtest: {
					...BACKTEST_RESULT.summary,
					ref: "README.md#the-forecast-backtest",
				},
			},
		});
	});

	test("until the 2030 halving: the window ends at the halving", () => {
		const valuation = valueMiner({
			miner: MINER,
			network: NETWORK,
			days: DAYS,
			window: "to-2030-halving",
		});
		expect(valuation.window).toEqual({
			from: READ_AT.time,
			to: FIRST_HALVING,
			label: "to-2030-halving",
		});
		// The model's backtest covers its 30-day range only; the screen says this view isn't tested
		expect(valuation.model.backtest).toMatchObject({ horizonDays: 30 });
		expect(valuation.range).toEqual(
			outputRange({
				minerWeight: 412n,
				weightWithoutBonus: 96n,
				networkWeight: 1_614_500n,
				growth: { fast: 1_873n, expected: 684n, slow: 0n },
				from: READ_AT.time,
				to: FIRST_HALVING,
			}),
		);
	});

	test.each([
		[
			"a miner read at another block",
			{
				miner: { ...MINER, readAt: { ...READ_AT, block: READ_AT.block - 1n } },
			},
			"was read at block",
		],
		[
			"a miner that isn't mining",
			{
				miner: {
					...MINER,
					status: "cooling" as const,
					weight: 0n,
					weightWithoutBonus: 0n,
					holdsBonus: false,
				},
			},
			"is not mining",
		],
		[
			"an unverified miner",
			{
				miner: {
					...MINER,
					pool: "unverified" as const,
					taskId: null,
					weight: 96n,
					holdsBonus: false,
				},
			},
			"unverified pool",
		],
		[
			"a missing day in the 30",
			{ days: DAYS.filter((d) => d.time !== 1_794_528_000n) },
			"No network sample for 13 Nov 2026",
		],
	])("refuses %s, with a clear error", (_what, overrides, message) => {
		expect(() =>
			valueMiner({
				miner: MINER,
				network: NETWORK,
				days: DAYS,
				window: "30d",
				...overrides,
			}),
		).toThrow(
			expect.objectContaining({
				name: "ValuationInputError",
				message: expect.stringContaining(message),
			}),
		);
	});
});
