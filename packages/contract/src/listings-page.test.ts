import { describe, expect, test } from "vitest";
import { parseListingsPage, serialiseListingsPage } from "./index.ts";

// The live listings page's response (docs/data-contract.md, "API responses"). Counts are the
// market at BNB block 134,724,711: 294 buyable mining miners among 6,176 open listings.

const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const HASH = `0x${"ab".repeat(32)}`;
const AT_BNB = { chainId: 56, block: "134724711", time: "1795190000" };
const AT_BLOCK = { source: "chain", chainId: 56, block: "134724711" };
const INDEX = {
	circuitsChecked: "80290",
	upTo: [{ chainId: 56, block: "134712080" }],
};

function circuit(tokenId: string) {
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

function valuation(base: string) {
	const weight = { value: "1578", ...AT_BLOCK };
	return {
		minerKey: `0x${"3f".repeat(32)}`,
		pool: "verified",
		window: { from: "1795190000", to: "1797782000", label: "30d" },
		range: { low: base, base, high: base },
		inputs: {
			minerWeight: { low: weight, base: weight, high: weight },
			networkWeight: { value: "1614135", ...AT_BLOCK },
			growthPpm: {
				low: { value: "1873", source: "assumption", basis: "14 days" },
				base: { value: "684", source: "assumption", basis: "14 days" },
				high: { value: "82", source: "assumption", basis: "14 days" },
			},
			emissionRate: {
				value: "8333333",
				source: "constant",
				ref: "PodMining.INITIAL_RATE",
			},
		},
		model: { version: "v0.1", backtest: "pending" },
	};
}

/** A buyable mining miner's row, listed at `listedBlock`. */
function row(
	tokenId: string,
	listingId: string,
	listedBlock: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		listing: {
			listingId,
			seller: `0x${"fd".repeat(20)}`,
			ask: { currency: "BNB", value: "53800000000000000000" },
			listedAt: { block: listedBlock, time: "1795170000" },
			buyable: true,
			readAt: AT_BNB,
		},
		circuit: circuit(tokenId),
		multiplier: 6,
		check: {
			state: "checked",
			originality: {
				circuit: circuit(tokenId),
				scope: "miner",
				mining: {
					chainId: 56,
					contract: "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46",
				},
				result: { verdict: "no-earlier-copy", netlistHash: HASH },
				facts: [{ fact: "can-mine", state: "mining" }],
				occc: { status: "not-checked" },
				index: INDEX,
				ruleVersion: "hash 2026-11-20, floor 4, chain 10",
			},
		},
		value30d: { state: "shown", valuation: valuation("20700000000") },
		...overrides,
	};
}

function wirePage(overrides: Record<string, unknown> = {}) {
	return {
		set: "mining",
		verdict: null,
		market: { venue: "bnb-market", upTo: AT_BNB },
		index: INDEX,
		counts: {
			open: 6176,
			buyable: 5899,
			sellers: 329,
			bySet: { mining: 294, all: 6176 },
			byVerdict: {
				"no-earlier-copy": 46,
				copy: 82,
				"too-small-to-tell": 166,
				wrapper: 0,
				"cant-check": 0,
				"not-checked": 0,
			},
		},
		rows: [
			row("2421", "28074", "134700000"),
			row("1080", "26474", "134100000"),
		],
		next: "26474",
		...overrides,
	};
}

describe("a listings page on the wire", () => {
	test("reads back unchanged: the counts behind the chips and fact line, and the newest rows", () => {
		const page = parseListingsPage(wirePage(), "page");
		expect(page).toMatchObject({
			set: "mining",
			counts: { bySet: { mining: 294 }, byVerdict: { copy: 82 } },
			rows: [
				{ listing: { listingId: 28_074n } },
				{ listing: { listingId: 26_474n } },
			],
		});
		const sent = JSON.parse(
			JSON.stringify(serialiseListingsPage(page, "page")),
		);
		expect(sent).toEqual(wirePage());
	});
});

describe("a listings page that doesn't hold together", () => {
	const counts = wirePage().counts;
	const second = row("1080", "26474", "134100000");

	test.each([
		[
			"verdict counts that don't add up to the set",
			{ counts: { ...counts, byVerdict: { ...counts.byVerdict, copy: 81 } } },
			"page.counts.byVerdict",
		],
		[
			"more buyable listings than open ones",
			{ counts: { ...counts, buyable: 6177 } },
			"page.counts.buyable",
		],
		[
			"a count of all listings that isn't the open count",
			{ counts: { ...counts, bySet: { mining: 294, all: 6175 } } },
			"page.counts.bySet.all",
		],
		[
			"more mining miners than buyable listings",
			{ counts: { ...counts, bySet: { mining: 5900, all: 6176 } } },
			"page.counts.bySet.mining",
		],
		[
			"more than 50 rows",
			{
				rows: Array.from({ length: 51 }, (_, i) =>
					row(`${1000 + i}`, `${20000 - i}`, `${134700000 - i}`),
				),
			},
			"page.rows",
		],
		[
			"rows that aren't newest first",
			{ rows: [second, row("2421", "28074", "134700000")] },
			"page.rows[1].listing.listedAt",
		],
		[
			"a row that doesn't match the verdict filter",
			{ verdict: "copy" },
			"page.rows[0].check",
		],
		[
			"a mining row that can't be bought",
			{
				rows: [
					row("2421", "28074", "134700000", {
						listing: { ...second.listing, listingId: "28074", buyable: false },
					}),
				],
			},
			"page.rows[0].listing.buyable",
		],
		[
			"a mining row with no value",
			{
				rows: [
					row("2421", "28074", "134700000", {
						value30d: { state: "not-mining" },
					}),
				],
			},
			"page.rows[0].value30d",
		],
		[
			"a row whose stored result is another circuit's",
			{
				rows: [row("2421", "28074", "134700000", { check: second.check })],
			},
			"page.rows[0].check.originality.circuit",
		],
		[
			"a row valued over another window",
			{
				rows: [
					row("2421", "28074", "134700000", {
						value30d: {
							state: "shown",
							valuation: {
								...valuation("20700000000"),
								window: {
									from: "1795190000",
									to: "1913318132",
									label: "to-2030-halving",
								},
							},
						},
					}),
				],
			},
			"page.rows[0].value30d.valuation.window.label",
		],
	] as [string, Record<string, unknown>, string][])(
		"is refused: %s",
		(_why, overrides, field) => {
			expect(() => parseListingsPage(wirePage(overrides), "page")).toThrow(
				expect.objectContaining({ name: "ContractParseError", field }),
			);
		},
	);

	test("a row with no stored result counts as not checked, never as a verdict", () => {
		const unchecked = row("2421", "28074", "134700000", {
			check: { state: "not-checked", detail: "taped out after the index" },
		});
		const page = parseListingsPage(
			wirePage({
				verdict: "not-checked",
				rows: [unchecked],
				counts: {
					...counts,
					byVerdict: {
						...counts.byVerdict,
						"no-earlier-copy": 45,
						"not-checked": 1,
					},
				},
			}),
			"page",
		);
		expect(page.rows[0]?.check).toEqual({
			state: "not-checked",
			detail: "taped out after the index",
		});
	});

	test("a mining row in the unverified pool shows not valued yet, with the reason", () => {
		const page = parseListingsPage(
			wirePage({
				rows: [
					row("2421", "28074", "134700000", {
						value30d: {
							state: "not-valued",
							reason: "Foreman doesn't value the unverified pool yet",
						},
					}),
				],
			}),
			"page",
		);
		expect(page.rows[0]?.value30d.state).toBe("not-valued");
	});
});
