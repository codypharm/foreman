import { describe, expect, test } from "vitest";
import {
	parseProPaymentAnswer,
	parseProPaymentRequest,
	serialiseProPaymentAnswer,
	serialiseProPaymentRequest,
} from "./index.ts";
import { parseHex32 } from "./wire.ts";

// Reporting a Foreman Pro payment: the transaction that paid, and when the chat's Pro now ends.

const tx = parseHex32(`0x${"7c".repeat(32)}`, "tx");

describe("Pro payments", () => {
	test("the request and the answer round-trip, with or without a chat", () => {
		expect(
			parseProPaymentRequest(
				serialiseProPaymentRequest({ txHash: tx }, "r"),
				"r",
			),
		).toEqual({
			txHash: tx,
		});
		for (const answer of [
			{ txHash: tx, proUntil: 1_798_286_400n },
			{ txHash: tx, proUntil: null },
		]) {
			expect(
				parseProPaymentAnswer(serialiseProPaymentAnswer(answer, "a"), "a"),
			).toEqual(answer);
		}
	});

	test("a transaction hash in capitals is read in lowercase; anything else is refused", () => {
		expect(
			parseProPaymentRequest({ txHash: `0x${"7C".repeat(32)}` }, "r").txHash,
		).toBe(tx);
		expect(() => parseProPaymentRequest({ txHash: "0x1234" }, "r")).toThrow();
		expect(() => parseProPaymentAnswer({ txHash: tx }, "a")).toThrow(
			/proUntil/,
		);
	});
});
