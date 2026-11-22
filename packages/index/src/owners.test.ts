import { scanCircuitTransfers } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import transfers from "@foreman/chain-bnb/fixtures/bnb-transfers-135080000-135129999.json" with {
	type: "json",
};
import type pg from "pg";
import { decodeFunctionResult, type Hex } from "viem";
import { afterEach, describe, expect, test } from "vitest";
import { followOwners, readCircuitOwners, saveOwnerScan } from "./index.ts";
import { ownersIndexedDatabase, TEST_DATABASE_URL } from "./testing.ts";

// The eligible processors' Transfer events in blocks 135,080,000 to 135,129,999 (14 transfers of
// 14 circuits, 7 of them mints), and each circuit's ownerOf at the last block, read on 22 Nov 2026.
// Rules: docs/decisions/2026-11-22-wallet-miners.md.
const RANGE = { fromBlock: 135_080_000n, toBlock: 135_129_999n };

async function windowScan() {
	const scan = await scanCircuitTransfers(replayClient(transfers), RANGE);
	if (!scan.complete) throw new Error(scan.detail);
	return scan;
}

/** Each circuit's ownerOf at the window's last block, from the fixture's own reads. */
function ownersOnChain(): Map<string, string> {
	const owners = new Map<string, string>();
	for (const c of transfers.calls) {
		const p = (c.params as { to?: string; data?: string }[])[0];
		if (c.method !== "eth_call" || !p?.data?.startsWith("0x6352211e")) continue;
		const owner = decodeFunctionResult({
			abi: [
				{
					name: "ownerOf",
					type: "function",
					stateMutability: "view",
					inputs: [{ name: "id", type: "uint256" }],
					outputs: [{ name: "", type: "address" }],
				},
			],
			functionName: "ownerOf",
			data: c.result as Hex,
		});
		owners.set(
			`${p.to?.toLowerCase()}/${BigInt(`0x${p.data.slice(10)}`)}`,
			owner.toLowerCase(),
		);
	}
	return owners;
}

describe.skipIf(!TEST_DATABASE_URL)("saving circuit owners", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("after the window, each circuit's stored owner is the one the processor's ownerOf gives", async () => {
		const scan = await windowScan();
		pool = await ownersIndexedDatabase(scan);
		await saveOwnerScan(pool, scan);
		const stored = await readCircuitOwners(pool);
		expect(stored.upToBlock).toBe(RANGE.toBlock);
		const onChain = ownersOnChain();
		expect(onChain.size).toBe(14);
		for (const [circuit, owner] of onChain) {
			expect(stored.owners.get(circuit)?.owner, circuit).toBe(owner);
		}
	});

	describe("refuses the whole scan, saving nothing", () => {
		async function refused(
			change: (
				scan: Awaited<ReturnType<typeof windowScan>>,
			) => Awaited<ReturnType<typeof windowScan>>,
			message: RegExp,
		) {
			const scan = await windowScan();
			pool = await ownersIndexedDatabase(scan);
			const before = await readCircuitOwners(pool);
			await expect(saveOwnerScan(pool, change(scan))).rejects.toThrow(message);
			expect(await readCircuitOwners(pool)).toEqual(before);
			expect(before.upToBlock).toBe(RANGE.fromBlock - 1n);
		}

		test("when a transfer's sender isn't the circuit's stored holder", async () => {
			await refused(
				(scan) => ({
					...scan,
					transfers: scan.transfers.map((t) =>
						t.id === 18_394n ? { ...t, from: t.to } : t,
					),
				}),
				/moved from .* but its stored holder is/,
			);
		});

		test("when the read came back empty though the index has tape-outs in the range", async () => {
			await refused(
				(scan) => ({ ...scan, transfers: [] }),
				/mints don't match the indexed tape-outs.*no mint for/,
			);
		});

		test("when it leaves a gap after the saved owners", async () => {
			await refused(
				(scan) => ({ ...scan, fromBlock: scan.fromBlock + 1n }),
				/owners are saved up to 135079999/,
			);
		});

		test("when it reaches past the indexed tape-outs", async () => {
			await refused(
				(scan) => ({ ...scan, upToBlock: scan.upToBlock + 1n }),
				/past the tape-outs indexed up to 135129999/,
			);
		});
	});

	test("refuses a first scan that starts after the eligible processors' first tape-out", async () => {
		const scan = await windowScan();
		pool = await ownersIndexedDatabase(scan, { onlyMints: true });
		// The window's first mint is in block 135,085,364
		await expect(
			saveOwnerScan(pool, {
				...scan,
				fromBlock: 135_085_365n,
				transfers: scan.transfers.filter((t) => t.at.block >= 135_085_365n),
			}),
		).rejects.toThrow(/after the first tape-out at 135085364/);
		expect((await readCircuitOwners(pool)).upToBlock).toBeNull();
	});
});

describe.skipIf(!TEST_DATABASE_URL)("following circuit owners", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("reads transfers from the block after the last saved one, and saves them", async () => {
		pool = await ownersIndexedDatabase(await windowScan());
		const result = await followOwners(pool, replayClient(transfers), {
			toBlock: RANGE.toBlock,
		});
		expect(result).toEqual({
			followed: true,
			toBlock: RANGE.toBlock,
			transfers: 14,
		});
		expect((await readCircuitOwners(pool)).upToBlock).toBe(RANGE.toBlock);
	});

	test("a failed read leaves the owners where they were, and says why", async () => {
		pool = await ownersIndexedDatabase(await windowScan());
		const result = await followOwners(
			pool,
			replayClient({ ...transfers, calls: [] }),
			{ toBlock: RANGE.toBlock },
		);
		expect(result).toMatchObject({
			followed: false,
			detail: expect.stringMatching(/Transfer read, blocks 135080000/),
		});
		expect((await readCircuitOwners(pool)).upToBlock).toBe(
			RANGE.fromBlock - 1n,
		);
	});

	test("does nothing when the owners are already at the block", async () => {
		pool = await ownersIndexedDatabase(await windowScan());
		expect(
			await followOwners(pool, replayClient({ ...transfers, calls: [] }), {
				toBlock: RANGE.fromBlock - 1n,
			}),
		).toEqual({ followed: true, toBlock: RANGE.fromBlock - 1n, transfers: 0 });
	});
});
