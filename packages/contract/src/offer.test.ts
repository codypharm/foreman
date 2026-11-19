import { describe, expect, test } from "vitest";
import { parseOffer, serialiseOffer } from "./index.ts";

const KEY =
	"0x146fed016999565b17ebee4442c9440fc97dfd312193463c9d54f33113b79fdb";
const TX = "0xf18e34efa47adce14536799025f20ee06053269747f24ae1cd76a88596f91e7c";
const AT_BNB = { chainId: 56, block: "134486640", time: "1795085000" };
const AT_XL = { chainId: 196, block: "76313481", time: "1795085000" };
const RULE = "same processor, weight within ±50%, last 30 days";

function wireSell(overrides: Record<string, unknown> = {}) {
	return {
		option: "sell",
		minerKey: KEY,
		bid: { state: "none", checkedAt: "1795085000" },
		sales: {
			venue: "bnb-market",
			rule: RULE,
			items: [
				{
					price: { currency: "BNB", value: "380000000000000000" },
					weight: "16",
					readAt: { chainId: 56, block: "134476085", time: "1795078961" },
					tx: TX,
				},
			],
		},
		asks: {
			venue: "bnb-market",
			rule: `${RULE}; asks above 10× the median sale per weight left out`,
			items: [
				{
					price: { currency: "BNB", value: "2380000000000000000" },
					weight: "2370",
					readAt: AT_BNB,
				},
			],
		},
		...overrides,
	};
}

describe("a Sell offer", () => {
	test("with no bid still carries labelled sales and asks of comparable miners", () => {
		const offer = parseOffer(wireSell(), "offer");
		expect(offer).toMatchObject({
			option: "sell",
			bid: { state: "none", checkedAt: 1_795_085_000n },
			sales: { venue: "bnb-market", rule: RULE },
		});
		if (offer.option !== "sell") throw new Error("not a sell offer");
		expect(offer.sales.items[0]?.price).toEqual({
			currency: "BNB",
			value: 380_000_000_000_000_000n,
		});
		expect(offer.asks.items[0]?.weight).toBe(2_370n);
	});

	test("with a live bid on X Layer says its currency and venue", () => {
		const bid = {
			state: "live",
			venue: "xlayer-market",
			readAt: AT_XL,
			price: { currency: "OKB", value: "1500000000000000000" },
			expiresAt: "1795171400",
		};
		const offer = parseOffer(wireSell({ bid }), "offer");
		expect(offer.option === "sell" && offer.bid).toMatchObject({
			state: "live",
			venue: "xlayer-market",
			price: { currency: "OKB", value: 1_500_000_000_000_000_000n },
		});
	});

	test.each([
		[
			"a bid of zero: a missing bid is state none",
			{
				bid: {
					state: "live",
					venue: "xlayer-market",
					readAt: AT_XL,
					price: { currency: "OKB", value: "0" },
					expiresAt: null,
				},
			},
			"offer.bid.price.value",
		],
		[
			"no bid without when it was checked",
			{ bid: { state: "none" } },
			"offer.bid.checkedAt",
		],
		[
			"a price with no currency",
			{
				bid: {
					state: "live",
					venue: "xlayer-market",
					readAt: AT_XL,
					price: { value: "1" },
					expiresAt: null,
				},
			},
			"offer.bid.price.currency",
		],
		[
			"a sale of a miner with no weight: there is no price per weight",
			{
				sales: {
					venue: "bnb-market",
					rule: RULE,
					items: [
						{
							price: { currency: "BNB", value: "1" },
							weight: "0",
							readAt: AT_BNB,
							tx: TX,
						},
					],
				},
			},
			"offer.sales.items[0].weight",
		],
		[
			"sales without the rule that picked them",
			{ sales: { venue: "bnb-market", rule: "", items: [] } },
			"offer.sales.rule",
		],
		[
			"a BNB-market sale read on X Layer",
			{
				sales: {
					venue: "bnb-market",
					rule: RULE,
					items: [
						{
							price: { currency: "BNB", value: "1" },
							weight: "1",
							readAt: AT_XL,
							tx: TX,
						},
					],
				},
			},
			"offer.sales.items[0].readAt.chainId",
		],
	])("is refused with %s", (_why, overrides, field) => {
		expect(() => parseOffer(wireSell(overrides), "offer")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});
});

describe("a Rent offer", () => {
	test("says when no rental venue exists, apart from a venue with no offer", () => {
		expect(
			parseOffer({ option: "rent", minerKey: KEY, state: "no-venue" }, "offer"),
		).toEqual({ option: "rent", minerKey: KEY, state: "no-venue" });
	});

	test("is never live: there is no rental venue to read one from", () => {
		expect(() =>
			parseOffer(
				{ option: "rent", minerKey: KEY, state: "live", bemPerDay: "1" },
				"offer",
			),
		).toThrow(
			expect.objectContaining({
				name: "ContractParseError",
				field: "offer.state",
			}),
		);
	});
});

describe("a Lend offer", () => {
	const live = {
		option: "lend",
		minerKey: KEY,
		state: "live",
		venue: "tapepool",
		readAt: AT_XL,
		receivedNow: { currency: "BEM", value: "850000000" },
		fee: { currency: "BEM", value: "6375000" },
		termDays: 7,
		repayment: "from-output-until-paid",
	};

	test("from TapePool: BEM received now, the fee and the term", () => {
		expect(parseOffer(live, "offer")).toMatchObject({
			state: "live",
			venue: "tapepool",
			receivedNow: { currency: "BEM", value: 850_000_000n },
			termDays: 7,
		});
	});

	test.each([
		["a term TapePool does not offer", { termDays: 30 }, "offer.termDays"],
		[
			"an advance not in BEM",
			{ receivedNow: { currency: "BNB", value: "1" } },
			"offer.receivedNow.currency",
		],
		["read on BNB Chain", { readAt: AT_BNB }, "offer.readAt.chainId"],
	])("is refused with %s", (_why, overrides, field) => {
		expect(() => parseOffer({ ...live, ...overrides }, "offer")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});

	test("may be none, with when it was checked", () => {
		expect(
			parseOffer(
				{
					option: "lend",
					minerKey: KEY,
					state: "none",
					checkedAt: "1795085000",
				},
				"offer",
			),
		).toMatchObject({ state: "none", checkedAt: 1_795_085_000n });
	});
});

describe("an offer written to the wire", () => {
	test.each([
		["sell, no bid", wireSell()],
		[
			"sell, live bid with no expiry",
			wireSell({
				bid: {
					state: "live",
					venue: "xlayer-market",
					readAt: AT_XL,
					price: { currency: "OKB", value: "1500000000000000000" },
					expiresAt: null,
				},
			}),
		],
		["rent, no venue", { option: "rent", minerKey: KEY, state: "no-venue" }],
		[
			"rent, none",
			{ option: "rent", minerKey: KEY, state: "none", checkedAt: "1795085000" },
		],
		[
			"lend, live",
			{
				option: "lend",
				minerKey: KEY,
				state: "live",
				venue: "tapepool",
				readAt: AT_XL,
				receivedNow: { currency: "BEM", value: "850000000" },
				fee: { currency: "BEM", value: "6375000" },
				termDays: 14,
				repayment: "from-output-until-paid",
			},
		],
	])("reads back unchanged: %s", (_name, wire) => {
		const offer = parseOffer(wire, "offer");
		const sent = JSON.parse(JSON.stringify(serialiseOffer(offer, "offer")));
		expect(sent).toEqual(wire);
		expect(parseOffer(sent, "offer")).toEqual(offer);
	});
});
