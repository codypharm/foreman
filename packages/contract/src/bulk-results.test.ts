import { describe, expect, test } from "vitest";
import { BULK_MAX, parseBulkRequest } from "./index.ts";

// POST /v1/results's request (docs/decisions/2026-11-26-api-keys.md, decision 4): 1 to 100 circuits,
// each named by chain, processor and id.

const ONE = {
	chainId: 56,
	processor: "0x1F5cb4AEae1807bf60c3B9C0d8ADbcc14E91F12c",
	tokenId: "2683",
};

describe("bulk request", () => {
	test("names each circuit by chain, processor (one spelling) and id", () => {
		expect(parseBulkRequest({ circuits: [ONE] }, "body")).toEqual({
			circuits: [
				{
					chainId: 56,
					processor: "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c",
					tokenId: 2683n,
				},
			],
		});
	});

	test.each([
		["no circuits", { circuits: [] }],
		["more than 100", { circuits: Array(BULK_MAX + 1).fill(ONE) }],
		["a chain Foreman doesn't read", { circuits: [{ ...ONE, chainId: 1 }] }],
		[
			"an id that isn't a whole number",
			{ circuits: [{ ...ONE, tokenId: "1.5" }] },
		],
		["no list", { circuit: ONE }],
	])("refuses %s", (_why, body) => {
		expect(() => parseBulkRequest(body, "body")).toThrow();
	});
});
