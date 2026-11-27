import { describe, expect, test } from "vitest";
import { apiPaymentCode, proCodeWord } from "./pro.ts";

// The code a payment for a wallet's API calls carries (docs/decisions/2026-11-26-paid-api-tier.md,
// decision 4): the wallet's address, then "foreman-api:".

const WALLET = "0x077ea6b4c1dfc7f7ec253d736c56898dfc192ea5";

describe("a wallet's API payment code", () => {
	test("is the wallet's 20 bytes followed by the 12 ASCII bytes foreman-api:", () => {
		const tag = Buffer.from("foreman-api:", "ascii").toString("hex");
		expect(tag).toHaveLength(24);
		expect(apiPaymentCode(WALLET)).toBe(`${WALLET}${tag}`);
	});

	test("is the same however the address is cased", () => {
		expect(apiPaymentCode(WALLET.toUpperCase().replace("0X", "0x"))).toBe(
			apiPaymentCode(WALLET),
		);
	});

	test("can never be a chat's code, whose last 16 bytes are zero", () => {
		const code = apiPaymentCode(WALLET);
		expect(code.slice(-32)).not.toBe("0".repeat(32));
		expect(proCodeWord(`0x${"ab".repeat(16)}`).slice(-32)).toBe("0".repeat(32));
	});

	test("refuses anything that isn't an address", () => {
		expect(() => apiPaymentCode("0x1234")).toThrow();
	});
});
