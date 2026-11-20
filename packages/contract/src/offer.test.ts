import { describe, expect, test } from "vitest";
import { parseOffer, serialiseOffer } from "./index.ts";

const KEY =
	"0x146fed016999565b17ebee4442c9440fc97dfd312193463c9d54f33113b79fdb";
const TX = "0xf18e34efa47adce14536799025f20ee06053269747f24ae1cd76a88596f91e7c";
const AT_BNB = { chainId: 56, block: "134486640", time: "1795085000" };
const AT_XL = { chainId: 196, block: "76313481", time: "1795085000" };
const RULE =
	"Mining miners in the verified pool, last 14 days, BNB per unit of weight";

/** Ten verified asks, weight 10 each, under the ceiling of the ten sales. */
function shownAsks(leftOut: number) {
	const sales = shownSales();
	return {
		...sales,
		rule: `${RULE}; asks over 3× the median sale left out`,
		items: sales.items.map(({ tx: _tx, ...ask }) => ask),
		leftOut,
	};
}

/** Ten verified sales, weight 10 each, and the range they give a weight-10 miner. */
function shownSales(overrides: Record<string, unknown> = {}) {
	return {
		venue: "bnb-market",
		pool: "verified",
		rule: RULE,
		items: Array.from({ length: 10 }, (_, i) => ({
			price: { currency: "BNB", value: `${330 + 10 * i}000000000000000` },
			weight: "10",
			readAt: { chainId: 56, block: `${134476085 + i}`, time: "1795078961" },
			tx: TX,
		})),
		range: {
			state: "shown",
			low: { currency: "BNB", value: "352500000000000000" },
			mid: { currency: "BNB", value: "375000000000000000" },
			high: { currency: "BNB", value: "397500000000000000" },
		},
		leftOut: 0,
		...overrides,
	};
}

function wireSell(overrides: Record<string, unknown> = {}) {
	return {
		option: "sell",
		minerKey: KEY,
		bid: { state: "none", checkedAt: "1795085000" },
		sales: {
			venue: "bnb-market",
			pool: "verified",
			rule: RULE,
			items: [
				{
					price: { currency: "BNB", value: "380000000000000000" },
					weight: "16",
					readAt: { chainId: 56, block: "134476085", time: "1795078961" },
					tx: TX,
				},
			],
			range: { state: "too-few", count: 1, minimum: 10 },
			leftOut: 0,
		},
		asks: {
			venue: "bnb-market",
			pool: "verified",
			rule: `${RULE}; asks over 3× the median sale left out`,
			items: [
				{
					price: { currency: "BNB", value: "2380000000000000000" },
					weight: "2370",
					readAt: AT_BNB,
				},
			],
			range: { state: "too-few-sales", sales: 1, minimum: 10 },
			leftOut: 0,
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

	test("from 10 sales or more carries the range for this miner", () => {
		const asks = {
			...wireSell().asks,
			range: { state: "too-few", count: 1, minimum: 10 },
		};
		const offer = parseOffer(wireSell({ sales: shownSales(), asks }), "offer");
		if (offer.option !== "sell") throw new Error("not a sell offer");
		expect(offer.sales.range).toEqual({
			state: "shown",
			low: { currency: "BNB", value: 352_500_000_000_000_000n },
			mid: { currency: "BNB", value: 375_000_000_000_000_000n },
			high: { currency: "BNB", value: 397_500_000_000_000_000n },
		});
	});

	test("for a miner that isn't mining has no pool and nothing comparable", () => {
		const none = {
			venue: "bnb-market",
			pool: null,
			rule: RULE,
			items: [],
			range: { state: "not-mining" },
			leftOut: 0,
		};
		const offer = parseOffer(wireSell({ sales: none, asks: none }), "offer");
		if (offer.option !== "sell") throw new Error("not a sell offer");
		expect(offer.sales).toMatchObject({
			pool: null,
			items: [],
			range: { state: "not-mining" },
		});
	});

	test("from 10 sales or more says how many asks were left out", () => {
		const offer = parseOffer(
			wireSell({ sales: shownSales(), asks: shownAsks(5) }),
			"offer",
		);
		if (offer.option !== "sell") throw new Error("not a sell offer");
		expect(offer.asks).toMatchObject({ range: { state: "shown" }, leftOut: 5 });
	});

	test("says its pool, why no range is shown, and how many asks were left out", () => {
		const offer = parseOffer(wireSell(), "offer");
		if (offer.option !== "sell") throw new Error("not a sell offer");
		expect(offer.sales).toMatchObject({
			pool: "verified",
			range: { state: "too-few", count: 1, minimum: 10 },
			leftOut: 0,
		});
		expect(offer.asks.range).toEqual({
			state: "too-few-sales",
			sales: 1,
			minimum: 10,
		});
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
		[
			"a range drawn from fewer than 10 sales",
			{ sales: { ...shownSales(), items: shownSales().items.slice(0, 9) } },
			"offer.sales.range",
		],
		[
			"too few sales counted differently from those listed",
			{
				sales: {
					...wireSell().sales,
					range: { state: "too-few", count: 3, minimum: 10 },
				},
			},
			"offer.sales.range.count",
		],
		[
			"too few sales when there are 10",
			{
				sales: {
					...shownSales(),
					range: { state: "too-few", count: 10, minimum: 10 },
				},
			},
			"offer.sales.range.count",
		],
		[
			"a range whose low is above its mid",
			{
				sales: shownSales({
					range: {
						...shownSales().range,
						low: { currency: "BNB", value: "380000000000000000" },
					},
				}),
			},
			"offer.sales.range",
		],
		[
			"a range in another currency from its sales",
			{
				sales: shownSales({
					range: {
						state: "shown",
						low: { currency: "BEM", value: "1" },
						mid: { currency: "BEM", value: "2" },
						high: { currency: "BEM", value: "3" },
					},
				}),
			},
			"offer.sales.range",
		],
		[
			"sales of other miners for a miner that isn't mining",
			{
				sales: {
					...wireSell().sales,
					pool: null,
					range: { state: "not-mining" },
				},
			},
			"offer.sales.range",
		],
		[
			"no pool for a miner that is mining",
			{ sales: { ...wireSell().sales, pool: null } },
			"offer.sales.pool",
		],
		[
			"a pool for a miner that isn't mining",
			{
				sales: {
					...wireSell().sales,
					items: [],
					range: { state: "not-mining" },
				},
			},
			"offer.sales.pool",
		],
		[
			"sales left out: only asks are",
			{ sales: shownSales({ leftOut: 1 }), asks: shownAsks(0) },
			"offer.sales.leftOut",
		],
		[
			"asks said to have too few sales when there are 10",
			{
				sales: shownSales(),
				asks: {
					...shownAsks(0),
					items: shownAsks(0).items.slice(0, 3),
					range: { state: "too-few-sales", sales: 10, minimum: 10 },
				},
			},
			"offer.asks.range",
		],
		[
			"asks counting other sales than those listed",
			{
				asks: {
					...wireSell().asks,
					range: { state: "too-few-sales", sales: 4, minimum: 10 },
				},
			},
			"offer.asks.range.sales",
		],
		[
			"asks said to be too few when the sales are too few",
			{
				asks: {
					...wireSell().asks,
					range: { state: "too-few", count: 1, minimum: 10 },
				},
			},
			"offer.asks.range",
		],
		[
			"too few sales on the sales themselves",
			{
				sales: {
					...wireSell().sales,
					range: { state: "too-few-sales", sales: 1, minimum: 10 },
				},
			},
			"offer.sales.range",
		],
		[
			"asks left out with no median sale to measure them against",
			{ asks: { ...wireSell().asks, leftOut: 2 } },
			"offer.asks.leftOut",
		],
		[
			"an asking range with too few sales to filter the asks",
			{ asks: shownAsks(0) },
			"offer.asks.range",
		],
		[
			"asks from another pool than the sales",
			{ asks: { ...wireSell().asks, pool: "unverified" } },
			"offer.asks.pool",
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
	// docs/decisions/2026-11-20-lend-from-tapepool.md: one offer per term, a live one only for a
	// voucher alone in its TapePool account, and every "none" with its reason.
	const live = {
		option: "lend",
		minerKey: KEY,
		termDays: 7,
		state: "live",
		venue: "tapepool",
		readAt: AT_XL,
		voucherId: "16",
		receivedNow: { currency: "BEM", value: "850000000" },
		fee: { currency: "BEM", value: "2125000" },
		opsFee: { currency: "OKB", value: "0" },
		repayment: "from-output-until-paid",
	};
	const none = (reason: unknown) => ({
		option: "lend",
		minerKey: KEY,
		termDays: 14,
		state: "none",
		checkedAt: "1795085000",
		reason,
	});

	test("from TapePool: the voucher, BEM received now, the fee, the OKB operating fee and the term", () => {
		expect(parseOffer(live, "offer")).toMatchObject({
			state: "live",
			venue: "tapepool",
			voucherId: 16n,
			receivedNow: { currency: "BEM", value: 850_000_000n },
			opsFee: { currency: "OKB", value: 0n },
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
		[
			"an advance of 0",
			{ receivedNow: { currency: "BEM", value: "0" } },
			"offer.receivedNow.value",
		],
		[
			"an operating fee not in OKB",
			{ opsFee: { currency: "BEM", value: "0" } },
			"offer.opsFee.currency",
		],
		["no operating fee", { opsFee: undefined }, "offer.opsFee"],
		["no voucher", { voucherId: undefined }, "offer.voucherId"],
		["read on BNB Chain", { readAt: AT_BNB }, "offer.readAt.chainId"],
	])("is refused with %s", (_why, overrides, field) => {
		expect(() => parseOffer({ ...live, ...overrides }, "offer")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});

	test.each([
		["a miner that isn't a RIG voucher", { kind: "not-a-voucher" }, {}],
		[
			"a voucher not deposited with TapePool",
			{ kind: "not-deposited", voucherId: "4" },
			{ voucherId: 4n },
		],
		[
			"a voucher sharing its TapePool account",
			{ kind: "shared-account", voucherId: "4", vouchers: 3 },
			{ voucherId: 4n, vouchers: 3 },
		],
		[
			"a voucher TapePool declines, with TapePool's reason",
			{ kind: "declined", voucherId: "16", tapepool: "paused" },
			{ voucherId: 16n, tapepool: "paused" },
		],
	])(
		"may be none for %s, with the term and when it was checked",
		(_why, reason, parsed) => {
			expect(parseOffer(none(reason), "offer")).toEqual({
				option: "lend",
				minerKey: KEY,
				termDays: 14,
				state: "none",
				checkedAt: 1_795_085_000n,
				reason: { kind: reason.kind, ...parsed },
			});
		},
	);

	test.each([
		["no reason", undefined, "offer.reason"],
		["an unknown reason", { kind: "too-small" }, "offer.reason.kind"],
		[
			"a shared account of one voucher",
			{ kind: "shared-account", voucherId: "4", vouchers: 1 },
			"offer.reason.vouchers",
		],
		[
			"TapePool's OK as a reason for no offer",
			{ kind: "declined", voucherId: "16", tapepool: "ok" },
			"offer.reason.tapepool",
		],
		[
			"a voucher missing from a reason that needs one",
			{ kind: "not-deposited" },
			"offer.reason.voucherId",
		],
	])("none is refused with %s", (_why, reason, field) => {
		expect(() => parseOffer(none(reason), "offer")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});

	test("none is refused without its term", () => {
		expect(() =>
			parseOffer(
				{ ...none({ kind: "not-a-voucher" }), termDays: undefined },
				"offer",
			),
		).toThrow(
			expect.objectContaining({
				name: "ContractParseError",
				field: "offer.termDays",
			}),
		);
	});
});

describe("an offer written to the wire", () => {
	test.each([
		["sell, no bid", wireSell()],
		[
			"sell, with a range and asks left out",
			wireSell({ sales: shownSales(), asks: shownAsks(5) }),
		],
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
				termDays: 14,
				state: "live",
				venue: "tapepool",
				readAt: AT_XL,
				voucherId: "16",
				receivedNow: { currency: "BEM", value: "850000000" },
				fee: { currency: "BEM", value: "4250000" },
				opsFee: { currency: "OKB", value: "0" },
				repayment: "from-output-until-paid",
			},
		],
		[
			"lend, none: declined",
			{
				option: "lend",
				minerKey: KEY,
				termDays: 7,
				state: "none",
				checkedAt: "1795085000",
				reason: { kind: "declined", voucherId: "16", tapepool: "no-room" },
			},
		],
		[
			"lend, none: not a voucher",
			{
				option: "lend",
				minerKey: KEY,
				termDays: 7,
				state: "none",
				checkedAt: "1795085000",
				reason: { kind: "not-a-voucher" },
			},
		],
	])("reads back unchanged: %s", (_name, wire) => {
		const offer = parseOffer(wire, "offer");
		const sent = JSON.parse(JSON.stringify(serialiseOffer(offer, "offer")));
		expect(sent).toEqual(wire);
		expect(parseOffer(sent, "offer")).toEqual(offer);
	});
});
