import { describe, expect, test } from "vitest";
import { parseApiError, serialiseApiError } from "./index.ts";

// The API's errors (docs/data-contract.md, "API responses"): plain words for the screen, never a
// crash, a silent zero or a partial page.

const ACCEPTED = [
	"a market listing number",
	"a miner key (0x and 64 hex digits)",
	"a circuit, as processor and id",
	"a RIG voucher number",
];

describe("an API error on the wire", () => {
	test.each([
		[
			{
				error: "not-recognised",
				detail: "“hello” isn't a listing, miner, circuit or voucher.",
				accepted: ACCEPTED,
			},
		],
		[
			{
				error: "unknown-circuit",
				detail: "No circuit #99999 on this processor in the index.",
			},
		],
		[{ error: "read-failed", detail: "BNB Chain didn't answer; try again." }],
		[{ error: "not-ready", detail: "The circuit index is still loading." }],
		[{ error: "unknown-wallet-input", detail: "That isn't a wallet address." }],
	])("reads back unchanged: %j", (wire) => {
		const error = parseApiError(wire, "error");
		expect(
			JSON.parse(JSON.stringify(serialiseApiError(error, "error"))),
		).toEqual(wire);
	});

	test.each([
		[
			"not recognised without saying what is accepted",
			{ error: "not-recognised", detail: "Not recognised." },
			"error.accepted",
		],
		[
			"a list of what's accepted on another error",
			{ error: "read-failed", detail: "No answer.", accepted: ACCEPTED },
			"error.accepted",
		],
		[
			"no words for the screen",
			{ error: "read-failed", detail: " " },
			"error.detail",
		],
		[
			"an error the contract doesn't name",
			{ error: "oops", detail: "Oops." },
			"error.error",
		],
	] as [string, Record<string, unknown>, string][])(
		"is refused: %s",
		(_why, wire, field) => {
			expect(() => parseApiError(wire, "error")).toThrow(
				expect.objectContaining({ name: "ContractParseError", field }),
			);
		},
	);
});
