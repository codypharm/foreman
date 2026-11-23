import { describe, expect, test } from "vitest";
import {
	ContractParseError,
	parseCheckAnswer,
	serialiseCheckAnswer,
} from "./index.ts";

// The Check box's answer (docs/data-contract.md, "API responses": GET /check returns
// { processor, tokenId }): the one circuit an input names.

describe("the Check box's answer on the wire", () => {
	const wire = {
		processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
		tokenId: "12814",
	};

	test("reads back unchanged", () => {
		const answer = parseCheckAnswer(wire, "check");
		expect(answer).toEqual({ processor: wire.processor, tokenId: 12814n });
		expect(
			JSON.parse(JSON.stringify(serialiseCheckAnswer(answer, "check"))),
		).toEqual(wire);
	});

	test.each([
		[{ ...wire, processor: "0xnot-an-address" }],
		[{ ...wire, tokenId: 12814 }],
		[{ ...wire, tokenId: "-1" }],
		[{ processor: wire.processor }],
		[null],
	])("refuses %j", (bad) => {
		expect(() => parseCheckAnswer(bad, "check")).toThrow(ContractParseError);
	});
});
