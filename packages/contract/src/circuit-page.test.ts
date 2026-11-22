import { describe, expect, test } from "vitest";
import { parseCircuitPage, serialiseCircuitPage } from "./index.ts";

// The result page's response (docs/data-contract.md, "API responses"; docs/decisions/2026-11-21-api-endpoints.md).
// Its parts are the contract's existing shapes; these tests prove the page holds together as one circuit.

const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const KEY =
	"0x3f9a00000000000000000000000000000000000000000000000000000000c21e";
const HASH = `0x${"ab".repeat(32)}`;
const AT_BNB = { chainId: 56, block: "134724711", time: "1795190000" };

function circuit(tokenId = "2421") {
	return {
		chainId: 56,
		processor: PROCESSOR,
		tokenId,
		tapedOutAt: {
			block: "122174306",
			txIndex: 3,
			logIndex: 7,
			time: "1789000000",
		},
		tapedOutBy: `0x${"12".repeat(20)}`,
		designCommittedAt: null,
	};
}

function originality(scope: "miner" | "listed" | "pasted", tokenId = "2421") {
	return {
		circuit: circuit(tokenId),
		scope,
		result: { verdict: "no-earlier-copy", netlistHash: HASH },
		facts: [{ fact: "can-mine", state: "not-started" }],
		occc: { status: "not-checked" },
		index: {
			circuitsChecked: "80290",
			upToBlock: { chainId: 56, block: "134712080" },
		},
		ruleVersion: "hash 2026-11-20, floor 4, chain 10",
	};
}

const NOT_MINING_COMPARABLES = {
	venue: "bnb-market",
	pool: null,
	rule: "Mining miners in the same pool, last 14 days, BNB per unit of weight",
	items: [],
	range: { state: "not-mining" },
	leftOut: 0,
};

/** A circuit that has never mined and isn't listed: pasted into the Check box. */
function wireNeverMined(overrides: Record<string, unknown> = {}) {
	return {
		circuit: circuit(),
		multiplier: 6,
		check: { state: "checked", originality: originality("pasted") },
		published: { state: "not-published", reason: "pasted" },
		miner: null,
		listing: null,
		voucher: null,
		hold: { state: "not-mining" },
		payback: { state: "not-mining", minerKey: KEY, readAt: AT_BNB },
		options: {
			sell: {
				option: "sell",
				minerKey: KEY,
				bid: { state: "none", checkedAt: "1795190000" },
				sales: NOT_MINING_COMPARABLES,
				asks: NOT_MINING_COMPARABLES,
			},
			lend: [7, 14].map((termDays) => ({
				option: "lend",
				minerKey: KEY,
				termDays,
				state: "none",
				checkedAt: "1795190000",
				reason: { kind: "not-a-voucher" },
			})),
			rent: { option: "rent", minerKey: KEY, state: "no-venue" },
		},
		bemPrice: {
			state: "no-price",
			reason: "the pool has no 30-minute history",
		},
		...overrides,
	};
}

const AT_BLOCK = { source: "chain", chainId: 56, block: "134724711" };
const GROWTH = "growth measured over the last 14 days";
const INPUTS = {
	minerWeight: {
		low: { value: "330", ...AT_BLOCK },
		base: { value: "1578", ...AT_BLOCK },
		high: { value: "1578", ...AT_BLOCK },
	},
	networkWeight: { value: "1614135", ...AT_BLOCK },
	growthPpm: {
		low: { value: "1873", source: "assumption", basis: GROWTH },
		base: { value: "684", source: "assumption", basis: GROWTH },
		high: { value: "82", source: "assumption", basis: GROWTH },
	},
	emissionRate: {
		value: "8333333",
		source: "constant",
		ref: "PodMining.INITIAL_RATE",
	},
};
const MODEL = { version: "v0.1", backtest: "pending" };
const BEM_PRICE = {
	bnbPerBem: "3750000000000000",
	pool: "0x28b12792f9d81bd529bc5572434e861c9edbbbc2",
	averagedOver: 1800,
	poolBem: "474238142846",
	poolWbnb: "17807194421184457178",
	readAt: AT_BNB,
};
const ASK = { currency: "BNB", value: "53800000000000000000" };
const RULE =
	"Mining miners in the verified pool, last 14 days, BNB per unit of weight";

function valuation(label: "30d" | "to-2030-halving") {
	return {
		minerKey: KEY,
		pool: "verified",
		window:
			label === "30d"
				? { from: "1795190000", to: "1797782000", label }
				: { from: "1795190000", to: "1913318132", label },
		range:
			label === "30d"
				? { low: "4260000000", base: "20700000000", high: "20880000000" }
				: { low: "71900000000", base: "619200000000", high: "901300000000" },
		inputs: INPUTS,
		model: MODEL,
	};
}

/** Circuit #2421: mining with the design bonus, listed at 53.8 BNB, its result published on the testnet. */
function wireMiningListed(overrides: Record<string, unknown> = {}) {
	return {
		...wireNeverMined(),
		check: {
			state: "checked",
			originality: {
				...originality("miner"),
				facts: [
					{ fact: "can-mine", state: "mining" },
					{ fact: "design-bonus", holds: true, bonus: "1248" },
				],
			},
		},
		published: {
			state: "current",
			publishedAt: {
				chainId: 1952,
				block: "46803541",
				tx: `0x${"52".repeat(32)}`,
			},
			contract: "0xe1b2343d3da66afec740c0fcaf40a701e2d513e8",
			resultHash: `0x${"cd".repeat(32)}`,
		},
		miner: {
			key: KEY,
			processor: PROCESSOR,
			tokenId: "2421",
			owner: `0x${"fd".repeat(20)}`,
			status: "active",
			pool: "verified",
			taskId: 150,
			weight: "1578",
			weightWithoutBonus: "330",
			holdsBonus: true,
			miningSince: "1789000000",
			readAt: AT_BNB,
		},
		listing: {
			listingId: "28074",
			seller: `0x${"fd".repeat(20)}`,
			ask: ASK,
			listedAt: { block: "134700000", time: "1795170000" },
			buyable: true,
			readAt: AT_BNB,
		},
		hold: {
			state: "shown",
			thirtyDays: valuation("30d"),
			toHalving: valuation("to-2030-halving"),
		},
		payback: {
			state: "shown",
			minerKey: KEY,
			listingId: "28074",
			ask: ASK,
			bemPrice: BEM_PRICE,
			askInBem: "1434666666667",
			days: { low: null, base: null, high: null },
			inputs: INPUTS,
			readAt: AT_BNB,
			model: MODEL,
		},
		options: {
			...wireNeverMined().options,
			sell: {
				option: "sell",
				minerKey: KEY,
				bid: { state: "none", checkedAt: "1795190000" },
				sales: {
					venue: "bnb-market",
					pool: "verified",
					rule: RULE,
					items: [
						{
							price: { currency: "BNB", value: "56600000000000000000" },
							weight: "1578",
							readAt: AT_BNB,
							tx: `0x${"aa".repeat(32)}`,
						},
					],
					range: { state: "too-few", count: 1, minimum: 10 },
					leftOut: 0,
				},
				asks: {
					venue: "bnb-market",
					pool: "verified",
					rule: `${RULE}; asks over 3× the median sale left out`,
					items: [{ price: ASK, weight: "1578", readAt: AT_BNB }],
					range: { state: "too-few-sales", sales: 1, minimum: 10 },
					leftOut: 0,
				},
			},
		},
		bemPrice: BEM_PRICE,
		...overrides,
	};
}

describe("a circuit page on the wire", () => {
	test("for a circuit that never mined reads back unchanged, every option saying why there's none", () => {
		const page = parseCircuitPage(wireNeverMined(), "page");
		expect(page).toMatchObject({
			circuit: { processor: PROCESSOR, tokenId: 2421n },
			miner: null,
			hold: { state: "not-mining" },
			published: { state: "not-published", reason: "pasted" },
		});
		const sent = JSON.parse(JSON.stringify(serialiseCircuitPage(page, "page")));
		expect(sent).toEqual(wireNeverMined());
	});

	test("for a mining, listed miner reads back unchanged with its value, payback and published result", () => {
		const page = parseCircuitPage(wireMiningListed(), "page");
		expect(page).toMatchObject({
			miner: { status: "active", weight: 1_578n },
			listing: { listingId: 28_074n, buyable: true },
			hold: {
				state: "shown",
				thirtyDays: { range: { base: 20_700_000_000n } },
			},
			payback: { state: "shown", askInBem: 1_434_666_666_667n },
			published: { state: "current", publishedAt: { chainId: 1952 } },
		});
		const sent = JSON.parse(JSON.stringify(serialiseCircuitPage(page, "page")));
		expect(sent).toEqual(wireMiningListed());
	});
});

describe("a circuit page about more than one circuit", () => {
	const OTHER_KEY = `0x${"77".repeat(32)}`;
	const mining = wireMiningListed();

	test.each([
		[
			"a stored result for another circuit",
			{
				check: {
					state: "checked",
					originality: originality("pasted", "2422"),
				},
			},
			"page.check.originality.circuit",
		],
		[
			"a miner read for another circuit",
			{ miner: { ...mining.miner, tokenId: "2422" } },
			"page.miner",
		],
		[
			"a payback for another miner",
			{ payback: { ...mining.payback, minerKey: OTHER_KEY } },
			"page.payback.minerKey",
		],
		[
			"a value for another miner",
			{
				hold: {
					...mining.hold,
					toHalving: { ...valuation("to-2030-halving"), minerKey: OTHER_KEY },
				},
			},
			"page.hold.toHalving.minerKey",
		],
		[
			"a Rent option for another miner",
			{
				options: {
					...mining.options,
					rent: { option: "rent", minerKey: OTHER_KEY, state: "no-venue" },
				},
			},
			"page.options.rent.minerKey",
		],
	] as [string, Record<string, unknown>, string][])(
		"is refused: %s",
		(_why, overrides, field) => {
			expect(() =>
				parseCircuitPage(wireMiningListed(overrides), "page"),
			).toThrow(expect.objectContaining({ name: "ContractParseError", field }));
		},
	);
});

describe("a circuit page that contradicts itself", () => {
	const mining = wireMiningListed();
	const never = wireNeverMined();
	const stopped = {
		...mining.miner,
		status: "cooling",
		weight: "0",
		weightWithoutBonus: "0",
		holdsBonus: false,
	};
	const lendFor = (reason: Record<string, unknown>) =>
		[7, 14].map((termDays) => ({
			option: "lend",
			minerKey: KEY,
			termDays,
			state: "none",
			checkedAt: "1795190000",
			reason,
		}));

	test.each([
		[
			"an active miner shown with no value",
			{ hold: { state: "not-mining" } },
			"page.hold",
		],
		["a value for a miner that stopped", { miner: stopped }, "page.hold"],
		[
			"the two windows swapped",
			{
				hold: {
					state: "shown",
					thirtyDays: valuation("to-2030-halving"),
					toHalving: valuation("30d"),
				},
			},
			"page.hold.thirtyDays.window.label",
		],
		[
			"a payback for a listing the page doesn't have",
			{ listing: null },
			"page.payback",
		],
		[
			"a payback for another listing",
			{ payback: { ...mining.payback, listingId: "28075" } },
			"page.payback.listingId",
		],
		[
			"a payback for another asking price",
			{
				listing: {
					...mining.listing,
					ask: { currency: "BNB", value: "53900000000000000000" },
				},
			},
			"page.payback.ask",
		],
		[
			"an active miner with a buyable listing said not to be listed",
			{ payback: { state: "not-listed", minerKey: KEY, readAt: AT_BNB } },
			"page.payback.state",
		],
		[
			"a pasted result marked as published",
			{
				check: never.check,
				miner: null,
				listing: null,
				hold: never.hold,
				payback: never.payback,
				options: never.options,
			},
			"page.published",
		],
		[
			"a miner's result said to be pasted",
			{ published: { state: "not-published", reason: "pasted" } },
			"page.published.reason",
		],
		[
			"a Lend reason about a voucher the page doesn't have",
			{
				options: {
					...mining.options,
					lend: lendFor({ kind: "not-deposited", voucherId: "12" }),
				},
			},
			"page.options.lend[0].reason",
		],
		[
			"a voucher said not to be a voucher",
			{
				voucher: {
					voucherId: "12",
					holder: `0x${"fd".repeat(20)}`,
					readAt: { chainId: 196, block: "76432567", time: "1795190000" },
				},
			},
			"page.options.lend[0].reason",
		],
	] as [string, Record<string, unknown>, string][])(
		"is refused: %s",
		(_why, overrides, field) => {
			expect(() =>
				parseCircuitPage(wireMiningListed(overrides), "page"),
			).toThrow(expect.objectContaining({ name: "ContractParseError", field }));
		},
	);
});

describe("a mining miner in the unverified pool", () => {
	const NOT_VALUED = "Foreman doesn't value the unverified pool yet";
	const mining = wireMiningListed();
	const unverified = {
		...mining.miner,
		pool: "unverified",
		taskId: null,
		weight: "330",
		weightWithoutBonus: "330",
		holdsBonus: false,
	};
	const notValued = {
		miner: unverified,
		hold: { state: "not-valued", reason: NOT_VALUED },
		payback: {
			state: "not-valued",
			minerKey: KEY,
			reason: NOT_VALUED,
			readAt: AT_BNB,
		},
	};

	test("is shown as not valued yet, with the reason, never as a number or as not mining", () => {
		const page = parseCircuitPage(wireMiningListed(notValued), "page");
		expect(page.hold).toEqual({ state: "not-valued", reason: NOT_VALUED });
		expect(page.payback.state).toBe("not-valued");
		const sent = JSON.parse(JSON.stringify(serialiseCircuitPage(page, "page")));
		expect(sent).toEqual(wireMiningListed(notValued));
	});

	test.each([
		[
			"not valued for a verified miner, which the engine values",
			{ hold: notValued.hold, payback: notValued.payback },
			"page.hold",
		],
		[
			"a payback for a miner that isn't valued",
			{ miner: unverified, hold: notValued.hold },
			"page.payback.state",
		],
	] as [string, Record<string, unknown>, string][])(
		"is refused: %s",
		(_why, overrides, field) => {
			expect(() =>
				parseCircuitPage(wireMiningListed(overrides), "page"),
			).toThrow(expect.objectContaining({ name: "ContractParseError", field }));
		},
	);
});
