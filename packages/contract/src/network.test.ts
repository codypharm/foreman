import { describe, expect, test } from "vitest";
import { parseNetworkState, serialiseNetworkState } from "./index.ts";

// The mining contract's state at block 134,351,215 (docs/notes/2026-11-18-mining-contract-findings.md)
function wireNetwork(overrides: Record<string, unknown> = {}) {
	return {
		verifiedWeight: "1609667",
		unverifiedWeight: "5120",
		minerCount: "20807",
		verifiedMinerCount: "20159",
		readAt: { chainId: 56, block: "134351215", time: "1795000000" },
		...overrides,
	};
}

describe("network state on the wire", () => {
	test("parses to the contract's NetworkState", () => {
		expect(parseNetworkState(wireNetwork(), "network")).toEqual({
			verifiedWeight: 1_609_667n,
			unverifiedWeight: 5_120n,
			minerCount: 20_807n,
			verifiedMinerCount: 20_159n,
			readAt: { chainId: 56, block: 134_351_215n, time: 1_795_000_000n },
		});
	});

	test.each([
		[
			{ verifiedMinerCount: "20808" },
			"network.verifiedMinerCount",
			"more verified miners than miners",
		],
		[
			{ readAt: { chainId: 196, block: "1", time: "1" } },
			"network.readAt.chainId",
			"read on X Layer",
		],
		[{ verifiedWeight: 1609667 }, "network.verifiedWeight", "a JSON number"],
		[
			{ verifiedWeight: "" },
			"network.verifiedWeight",
			"empty, which BigInt reads as zero",
		],
	])("%j is refused at %s: %s", (overrides, field, _why) => {
		expect(() => parseNetworkState(wireNetwork(overrides), "network")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});

	test("written to the wire reads back unchanged", () => {
		const network = parseNetworkState(wireNetwork(), "network");
		const sent = JSON.parse(
			JSON.stringify(serialiseNetworkState(network, "network")),
		);
		expect(sent).toEqual(wireNetwork());
		expect(parseNetworkState(sent, "network")).toEqual(network);
	});
});
