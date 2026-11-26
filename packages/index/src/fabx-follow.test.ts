import { replayClient } from "@foreman/chain-bnb/fixture";
import type pg from "pg";
import { createPublicClient, custom, type PublicClient } from "viem";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../fixtures/fabx-follow-76829899.json" with {
	type: "json",
};
import { readFabxState } from "./fabx.ts";
import { followFabx } from "./fabx-follow.ts";
import {
	FABX_FOLLOW_FROM,
	FABX_FOLLOW_TO,
	fabxFollowDatabase,
	fakeFabxChange,
	TEST_DATABASE_URL,
	withExtraLogs,
} from "./testing.ts";

// Following FabX on X Layer (2026-11-26-fabx-follow.md): from block 76,829,600 to 76,829,899,
// recorded on 26 Nov 2026 (scripts/record-fabx-follow-fixture.ts). The range holds the real
// tape-outs #7161 (block 76,829,657), #7162 (798), #7163 (819) and #7164 (837).

const nodes = (extra: ReturnType<typeof fakeFabxChange>[] = []) => {
	const node = withExtraLogs(replayClient(fixture), extra);
	return { client: node as PublicClient, logNodes: [node] };
};

/** A node that fails every request: anything it is asked is a read that shouldn't happen. */
const refusing = (): PublicClient =>
	createPublicClient({
		transport: custom({
			request: async ({ method }) => {
				throw new Error(`asked ${method}`);
			},
		}),
	});

const stored = async (pool: pg.Pool) => ({
	state: await readFabxState(pool),
	miners: (
		await pool.query<{ miners_read_at_block: string | null }>(
			"select miners_read_at_block from xlayer_state",
		)
	).rows[0]?.miners_read_at_block,
	circuits: (
		await pool.query<{ id: string; netlist_status: string | null }>(
			"select id, netlist_status from xlayer_circuits order by id",
		)
	).rows,
});

describe.skipIf(!TEST_DATABASE_URL)("following FabX", () => {
	let pool: pg.Pool;
	afterEach(async () => {
		await pool?.end();
	});

	test("saves the new tape-outs, their netlists and every miner record, all at the block it follows to", async () => {
		pool = await fabxFollowDatabase();
		const r = await followFabx(pool, nodes(), { toBlock: FABX_FOLLOW_TO });
		expect(r).toMatchObject({
			followed: true,
			fromBlock: FABX_FOLLOW_FROM + 1n,
			toBlock: FABX_FOLLOW_TO,
			newCircuits: [7161n, 7162n, 7163n, 7164n],
			frozenAtBlock: null,
		});
		const after = await stored(pool);
		expect(after.state?.logsUpToBlock).toBe(FABX_FOLLOW_TO);
		expect(after.miners).toBe(String(FABX_FOLLOW_TO));
		expect(after.circuits.map((c) => c.id)).toEqual([
			"24",
			"7160",
			"7161",
			"7162",
			"7163",
			"7164",
		]);
		expect(after.circuits.filter((c) => c.netlist_status === null)).toEqual([]);
	});

	test.each(["Upgraded", "Paused"] as const)(
		"a fake %s event freezes FabX: saved up to the block before it, nothing after",
		async (kind) => {
			pool = await fabxFollowDatabase();
			const r = await followFabx(pool, nodes([fakeFabxChange(kind)]), {
				toBlock: FABX_FOLLOW_TO,
			});
			expect(r).toMatchObject({
				followed: true,
				toBlock: 76_829_809n,
				newCircuits: [7161n, 7162n],
				frozenAtBlock: 76_829_810n,
			});
			const after = await stored(pool);
			expect(after.state).toMatchObject({
				logsUpToBlock: 76_829_809n,
				frozenAtBlock: 76_829_810n,
			});
			expect(after.miners).toBe("76829809");
			expect(after.circuits.map((c) => c.id)).toEqual([
				"24",
				"7160",
				"7161",
				"7162",
			]);
		},
	);

	test("while frozen, reads nothing and saves nothing", async () => {
		pool = await fabxFollowDatabase();
		await followFabx(pool, nodes([fakeFabxChange("Upgraded")]), {
			toBlock: FABX_FOLLOW_TO,
		});
		const before = await stored(pool);
		const r = await followFabx(
			pool,
			{ client: refusing(), logNodes: [refusing()] },
			{ toBlock: 76_900_000n },
		);
		expect(r).toEqual({
			followed: "frozen",
			frozenAtBlock: 76_829_810n,
			upToBlock: 76_829_809n,
		});
		expect(await stored(pool)).toEqual(before);
	});

	test("a read that fails after the logs saves nothing: FabX stays at its block", async () => {
		pool = await fabxFollowDatabase();
		const before = await stored(pool);
		const replay = nodes().client;
		// Answers the chain id and the logs, then refuses the netlist reads
		const failing = createPublicClient({
			transport: custom({
				request: async (args) => {
					if (args.method === "eth_call") throw new Error("refused");
					return replay.request(args as never);
				},
			}),
		});
		const r = await followFabx(
			pool,
			{ client: failing, logNodes: [replay] },
			{ toBlock: FABX_FOLLOW_TO },
		);
		expect(r).toMatchObject({ followed: false });
		expect(await stored(pool)).toEqual(before);
	});

	test("a node that answers log reads with nothing is caught by the processor's count, and nothing is saved", async () => {
		pool = await fabxFollowDatabase();
		const before = await stored(pool);
		const replay = nodes().client;
		const empty = {
			request: async (args: { method: string; params?: unknown }) =>
				args.method === "eth_getLogs" ? [] : replay.request(args as never),
		};
		expect(
			await followFabx(
				pool,
				{ client: replay, logNodes: [empty] },
				{ toBlock: FABX_FOLLOW_TO },
			),
		).toEqual({
			followed: false,
			detail:
				"FabX's processor had issued up to #7164 at block 76829899; the logs give tape-outs up to #7160",
		});
		expect(await stored(pool)).toEqual(before);
	});

	test("a node on another chain is refused before anything is read", async () => {
		pool = await fabxFollowDatabase();
		const testnet = createPublicClient({
			transport: custom({
				request: async ({ method }) => {
					if (method === "eth_chainId") return "0x7a0"; // 1952, X Layer testnet
					throw new Error(`asked ${method}`);
				},
			}),
		});
		expect(
			await followFabx(
				pool,
				{ client: testnet, logNodes: [testnet] },
				{ toBlock: FABX_FOLLOW_TO },
			),
		).toEqual({
			followed: false,
			detail: "the X Layer node answers for chain 1952, not 196",
		});
	});
});
