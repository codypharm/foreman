import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiProblem, AppOutdated, fetchCheck } from "./api.ts";

// What the app does with an answer it can't read: an API answer that parses is used as it is; a 200
// answer the contract refuses means this tab's code is older (or newer) than the API's, so it says so
// and asks for a reload, instead of a vague error and a "Try again" that fails the same way.

function answer(status: number, body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify(body), { status })),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("reading the API", () => {
	test("an answer the contract reads is used as it is", async () => {
		answer(200, {
			processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
			tokenId: "5607",
		});
		await expect(fetchCheck("28218")).resolves.toEqual({
			processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
			tokenId: 5_607n,
		});
	});

	test("a 200 answer the contract refuses asks for a reload, saying Foreman was likely updated", async () => {
		answer(200, { processor: "0xb102", coverage: "27 of 30 days" });
		const read = fetchCheck("28218");
		await expect(read).rejects.toBeInstanceOf(AppOutdated);
		await expect(read).rejects.toThrow(/updated since you opened this page/);
	});

	test("an API error stays an API error, with its own words", async () => {
		answer(404, {
			error: "unknown-circuit",
			detail:
				"No listing 99999999 on TapeOut's circuit market up to BNB block 135,637,100",
		});
		await expect(fetchCheck("99999999")).rejects.toBeInstanceOf(ApiProblem);
	});
});
