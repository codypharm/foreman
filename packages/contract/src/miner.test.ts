import { describe, expect, test } from "vitest";
import { parseMiner, serialiseMiner } from "./index.ts";

// A verified miner holding the design bonus, as the BNB reader would send it
const KEY =
	"0x3f9a00000000000000000000000000000000000000000000000000000000c21e";
const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const OWNER = "0x00000000000000000000000000000000000000aa";

function wireMiner(overrides: Record<string, unknown> = {}) {
	return {
		key: KEY,
		processor: PROCESSOR,
		tokenId: "2430",
		owner: OWNER,
		status: "active",
		pool: "verified",
		taskId: 7,
		weight: "412",
		weightWithoutBonus: "96",
		holdsBonus: true,
		miningSince: "1790000000",
		readAt: { chainId: 56, block: "134351215", time: "1795000000" },
		...overrides,
	};
}

describe("a miner written to the wire", () => {
	test.each([
		["verified, holding the bonus", wireMiner()],
		[
			"unverified",
			wireMiner({
				pool: "unverified",
				taskId: null,
				holdsBonus: false,
				weightWithoutBonus: "412",
			}),
		],
	])("reads back unchanged: %s", (_name, wire) => {
		const miner = parseMiner(wire, "miner");
		const sent = JSON.parse(JSON.stringify(serialiseMiner(miner, "miner")));
		expect(sent).toEqual(wire);
		expect(parseMiner(sent, "miner")).toEqual(miner);
	});
});

describe("a miner that is not active", () => {
	const stopped = {
		weight: "0",
		weightWithoutBonus: "0",
		holdsBonus: false,
	};

	test.each(["cooling", "revoked", "not-mining"])(
		"(%s) earns nothing: weight 0, no bonus",
		(status) => {
			const miner = parseMiner(wireMiner({ status, ...stopped }), "miner");
			expect(miner.weight).toBe(0n);
		},
	);

	test.each([
		[{ ...stopped, weight: "412", weightWithoutBonus: "412" }, "miner.weight"],
		[{ ...stopped, weightWithoutBonus: "96" }, "miner.weightWithoutBonus"],
		[{ ...stopped, holdsBonus: true }, "miner.holdsBonus"],
	])(
		"is refused with %j: the contract zeroes a stopped miner's weights",
		(overrides, field) => {
			expect(() =>
				parseMiner(wireMiner({ status: "cooling", ...overrides }), "miner"),
			).toThrow(expect.objectContaining({ name: "ContractParseError", field }));
		},
	);
});

describe("an unverified miner", () => {
	test("has no task and no bonus", () => {
		const miner = parseMiner(
			wireMiner({
				pool: "unverified",
				taskId: null,
				holdsBonus: false,
				weight: "96",
				weightWithoutBonus: "96",
			}),
			"miner",
		);
		expect(miner.pool).toBe("unverified");
		expect(miner.taskId).toBeNull();
	});
});

describe("a miner on the wire", () => {
	test("parses to the contract's Miner", () => {
		expect(parseMiner(wireMiner(), "miner")).toEqual({
			key: KEY,
			processor: PROCESSOR,
			tokenId: 2430n,
			owner: OWNER,
			status: "active",
			pool: "verified",
			taskId: 7,
			weight: 412n,
			weightWithoutBonus: 96n,
			holdsBonus: true,
			miningSince: 1_790_000_000n,
			readAt: { chainId: 56, block: 134_351_215n, time: 1_795_000_000n },
		});
	});

	test.each([
		[
			{ status: "stopped" },
			"miner.status",
			"a status the contract does not have",
		],
		[{ status: undefined }, "miner.status", "no status"],
		[
			{ pool: "both" },
			"miner.pool",
			"a pool that is not verified or unverified",
		],
		[
			{ holdsBonus: "yes" },
			"miner.holdsBonus",
			"a bonus flag that is not true or false",
		],
		[
			{ readAt: { chainId: 196, block: "1", time: "1" } },
			"miner.readAt.chainId",
			"read on X Layer: mining is on BNB Chain",
		],
		[{ weight: 412 }, "miner.weight", "a weight as a JSON number"],
		[{ taskId: null }, "miner.taskId", "verified with no task"],
		[
			{ taskId: 0 },
			"miner.taskId",
			"verified with task 0, the contract's 'no task'",
		],
		[{ taskId: 7.5 }, "miner.taskId", "a task that is not a whole number"],
		[{ taskId: "7" }, "miner.taskId", "a task as text"],
		[
			{
				pool: "unverified",
				taskId: 7,
				holdsBonus: false,
				weightWithoutBonus: "412",
			},
			"miner.taskId",
			"unverified with a task",
		],
		[
			{ holdsBonus: false },
			"miner.weightWithoutBonus",
			"no bonus, yet weight without it differs (412 vs 96)",
		],
		[
			{ weightWithoutBonus: "412" },
			"miner.weightWithoutBonus",
			"holds the bonus, yet the bonus adds nothing",
		],
		[
			{ weightWithoutBonus: "500" },
			"miner.weightWithoutBonus",
			"weight without the bonus above the weight",
		],
		[
			{ pool: "unverified", taskId: null, weightWithoutBonus: "412" },
			"miner.holdsBonus",
			"unverified miners never hold the bonus",
		],
	])("%j is refused at %s: %s", (overrides, field, _why) => {
		expect(() => parseMiner(wireMiner(overrides), "miner")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});
});
