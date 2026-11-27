import { describe, expect, test } from "vitest";
import { parseApiKeyStatus, serialiseApiKeyStatus } from "./index.ts";
import { parseAddress } from "./wire.ts";

// GET /keys/:wallet: whether a wallet has a live key and when it was made, never the key itself, and
// when its paid API tier ends (docs/decisions/2026-11-26-paid-api-tier.md, decision 7).

const wallet = parseAddress("0x077ea6b4c1dfc7f7ec253d736c56898dfc192ea5", "w");

describe("ApiKeyStatus", () => {
	test("a wallet's key status round-trips, with or without a key", () => {
		for (const status of [
			{ wallet, madeAt: 1_795_700_000n, paidUntil: 1_798_305_971n },
			{ wallet, madeAt: 1_795_700_000n, paidUntil: null },
			{ wallet, madeAt: null, paidUntil: null },
		]) {
			expect(
				parseApiKeyStatus(serialiseApiKeyStatus(status, "s"), "s"),
			).toEqual(status);
		}
	});

	test("an answer carrying a key is refused: a key is shown only once", () => {
		expect(() =>
			parseApiKeyStatus(
				{ wallet, madeAt: "1795700000", paidUntil: null, key: "fmn_x" },
				"s",
			),
		).toThrow(/shown only once/);
	});

	test("an answer without paidUntil is refused, never read as unpaid", () => {
		expect(() =>
			parseApiKeyStatus({ wallet, madeAt: "1795700000" }, "s"),
		).toThrow(/paidUntil/);
	});
});
