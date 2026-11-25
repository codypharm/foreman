import { parseOriginality } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../../fixtures/readback-2893.json" with { type: "json" };
import { inTodaysShape } from "../../testing.ts";
import { compareWithPage, verdictWords } from "./read-back-compare.ts";

// Real data, 23 Nov 2026: circuit 0xb102…a14c/2893, published on X Layer testnet on 21 Nov as a copy of
// circuit #88 from BNB block 134,712,080 against 80,290 circuits, read back at testnet block 46,980,742;
// its page then showed the same copy at BNB block 135,273,897 against 80,409
// (docs/decisions/2026-11-23-same-verdict-read-back.md).
const recorded = {
	logged: inTodaysShape(fixture.logged),
	page: inTodaysShape(fixture.page),
};
const logged = parseOriginality(recorded.logged, "logged");
const onPage = parseOriginality(recorded.page, "page");

describe("comparing the published result with this page", () => {
	test("a newer check with the same verdict, evidence and can-mine state is the same verdict, not a difference", () => {
		expect(compareWithPage(logged, onPage)).toBe("same-verdict");
	});

	test("a byte-identical result is the same as this page", () => {
		expect(compareWithPage(logged, logged)).toBe("identical");
	});

	test("a different verdict is a change", () => {
		const other = parseOriginality(
			{
				...recorded.page,
				result: {
					verdict: "no-earlier-copy",
					netlistHash: recorded.page.result.netlistHash,
				},
			},
			"page",
		);
		expect(compareWithPage(logged, other)).toBe("changed");
	});

	test("a different can-mine state is a change", () => {
		const other = parseOriginality(
			{
				...recorded.page,
				facts: recorded.page.facts.map((f) =>
					f.fact === "can-mine"
						? { fact: "can-mine", state: "not-started" }
						: f,
				),
			},
			"page",
		);
		expect(compareWithPage(logged, other)).toBe("changed");
	});

	test("no result on the page is never the same", () => {
		expect(compareWithPage(logged, null)).toBe("changed");
	});

	test("the verdict in the product's words", () => {
		expect(verdictWords(logged)).toBe("Copy of circuit #88");
	});
});
