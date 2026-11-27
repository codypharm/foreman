import { describe, expect, test } from "vitest";
import { parseApiKeyStatus, serialiseApiKeyStatus } from "./index.ts";
import { parseAddress } from "./wire.ts";

// GET /keys/:wallet: whether a wallet has a live key and when it was made, never the key itself, and
// when its paid API tier ends (docs/decisions/2026-11-26-paid-api-tier.md, decision 7), and the key's
// last 4 characters (docs/decisions/2026-11-27-key-ending.md).

const wallet = parseAddress("0x077ea6b4c1dfc7f7ec253d736c56898dfc192ea5", "w");

describe("ApiKeyStatus", () => {
	test("a wallet's key status round-trips, with or without a key", () => {
		for (const status of [
			{
				wallet,
				madeAt: 1_795_700_000n,
				keyEnding: "a1_-",
				paidUntil: 1_798_305_971n,
			},
			// A key made before endings were kept
			{ wallet, madeAt: 1_795_700_000n, keyEnding: null, paidUntil: null },
			{ wallet, madeAt: null, keyEnding: null, paidUntil: null },
		]) {
			expect(
				parseApiKeyStatus(serialiseApiKeyStatus(status, "s"), "s"),
			).toEqual(status);
		}
	});

	test("an answer carrying a key is refused: a key is shown only once", () => {
		expect(() =>
			parseApiKeyStatus(
				{
					wallet,
					madeAt: "1795700000",
					keyEnding: null,
					paidUntil: null,
					key: "fmn_x",
				},
				"s",
			),
		).toThrow(/shown only once/);
	});

	test("an answer without paidUntil is refused, never read as unpaid", () => {
		expect(() =>
			parseApiKeyStatus({ wallet, madeAt: "1795700000", keyEnding: null }, "s"),
		).toThrow(/paidUntil/);
	});

	test("an ending is 4 key characters; anything longer could be the key, and missing is refused", () => {
		const status = (keyEnding: unknown) => ({
			wallet,
			madeAt: "1795700000",
			keyEnding,
			paidUntil: null,
		});
		for (const bad of ["a1b", "a1b2c", "fmn_a1b2c3d4", "a1b!", 1234])
			expect(() => parseApiKeyStatus(status(bad), "s")).toThrow(/keyEnding/);
		const { keyEnding: _, ...without } = status(null);
		expect(() => parseApiKeyStatus(without, "s")).toThrow(/keyEnding/);
		// A wallet with no key has no ending
		expect(() =>
			parseApiKeyStatus({ ...status("a1b2"), madeAt: null }, "s"),
		).toThrow(/keyEnding/);
	});
});
