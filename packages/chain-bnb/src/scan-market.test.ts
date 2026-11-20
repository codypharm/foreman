import { parseAddress } from "@foreman/contract";
import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-market-scan-134650000-134713299.json" with {
	type: "json",
};
import openListings from "../fixtures/market-scan-open-listings.json" with {
	type: "json",
};
import { type Fixture, replayClient } from "./fixture.ts";
import { scanMarket } from "./index.ts";

// One market scan, blocks 134,650,000 to 134,713,299, from 40 listings open at the end block
// (scripts/record-market-scan-fixture.ts). Expected values were decoded from the raw calls with
// Python, not by this scan.
const RANGE = { fromBlock: 134_650_000n, toBlock: 134_713_299n };
const END_TIME = 1_795_185_835n;
const open = openListings.map((l) => ({
	listingId: BigInt(l.listingId),
	seller: parseAddress(l.seller, "seller"),
	processor: parseAddress(l.processor, "processor"),
	tokenId: BigInt(l.tokenId),
	priceWei: BigInt(l.priceWei),
	feeBps: 100,
}));
/** 28,111 issued at the end block, less the range's 5 Listed events. */
const INDEXED = 28_106n;

function scan(
	options: { indexed?: bigint; window?: bigint; client?: Fixture } = {},
) {
	return scanMarket(replayClient(options.client ?? fixture), {
		...RANGE,
		listingsIndexed: options.indexed ?? INDEXED,
		open,
		stateWindowSeconds: options.window ?? 14n * 86_400n,
	});
}

describe("a market scan", () => {
	test("reads every listing an event touched again at the end block: open, or gone", async () => {
		const result = await scan();
		if (!result.complete) throw new Error(result.detail);
		expect(result).toMatchObject({
			upToBlock: RANGE.toBlock,
			upToTime: END_TIME,
			listingsIssued: 28_111n,
		});
		const gone = result.listings
			.filter((l) => !l.listing)
			.map((l) => l.listingId);
		expect(gone).toEqual([28_107n, 28_108n]);
		expect(result.listings.map((l) => l.listingId).sort()).toEqual([
			27_912n,
			28_079n,
			28_080n,
			28_081n,
			28_107n,
			28_108n,
			28_109n,
			28_110n,
			28_111n,
		]);
		expect(
			result.listings.find((l) => l.listingId === 27_912n)?.listing?.seller,
		).toBe("0xf321e19068971ddd281c3aeb2f2de5ebc4e15f6f");
	});

	test("gives each sale its miner's state at the block before the sale", async () => {
		const result = await scan();
		if (!result.complete) throw new Error(result.detail);
		expect(
			result.sales.map((s) => [s.sale.listingId, s.sale.at.block, s.miner]),
		).toEqual([
			// Both were circuits that never mined
			[
				28_107n,
				134_671_741n,
				{ status: 0, taskId: 0, verifWeight: 0n, unverWeight: 0n },
			],
			[
				28_108n,
				134_688_886n,
				{ status: 0, taskId: 0, verifWeight: 0n, unverWeight: 0n },
			],
		]);
	});

	test("leaves a sale older than the window without its miner's state, never a made-up one", async () => {
		// Window 15,000 s: from time 1,795,170,835, after 28,107 (1,795,167,123), before 28,108
		const result = await scan({ window: 15_000n });
		if (!result.complete) throw new Error(result.detail);
		expect(result.sales.map((s) => s.miner === null)).toEqual([true, false]);
	});

	test("reads every open listing's miner and whether it can be bought, at the end block", async () => {
		const result = await scan();
		if (!result.complete) throw new Error(result.detail);
		// The 40 given, less none gone, plus 27,912 opened in the range
		expect(result.states).toHaveLength(41);
		expect(
			result.states
				.filter((s) => !s.buyable)
				.map((s) => s.listingId)
				.sort(),
		).toEqual([27_993n, 28_078n]);
		expect(result.states.find((s) => s.listingId === 28_111n)).toEqual({
			listingId: 28_111n,
			buyable: true,
			miner: { status: 1, taskId: 220, verifWeight: 61n, unverWeight: 0n },
		});
	});

	test("stops when the listings indexed and listed don't add up to nextListingId", async () => {
		const result = await scan({ indexed: INDEXED - 1n });
		expect(result).toEqual({
			complete: false,
			detail: expect.stringContaining("nextListingId is 28111"),
		});
	});

	test("stops, never half-done, when a read fails", async () => {
		// The node doesn't answer one open listing's ownerOf
		const broken = {
			...fixture,
			calls: fixture.calls.filter(
				(c, i) =>
					!(
						c.method === "eth_call" &&
						(c.params as { data: string }[])[0]?.data.startsWith(
							"0x6352211e",
						) &&
						i ===
							fixture.calls.findIndex((x) =>
								(x.params as { data?: string }[])[0]?.data?.startsWith(
									"0x6352211e",
								),
							)
					),
			),
		};
		const result = await scan({ client: broken });
		expect(result.complete).toBe(false);
	});

	test("drops a listing the index held open once the range sold it, without reading it as open", async () => {
		const sold = {
			listingId: 28_107n,
			seller: parseAddress(
				"0x687b2dd8752c04707d29b85f334e918236a1ace3",
				"seller",
			),
			processor: parseAddress(
				"0xc38c95899cd21522ef5db37cd6be4cb422cef58a",
				"processor",
			),
			tokenId: 502n,
			priceWei: 1n,
			feeBps: 100,
		};
		const result = await scanMarket(replayClient(fixture), {
			...RANGE,
			listingsIndexed: INDEXED,
			open: [...open, sold],
			stateWindowSeconds: 14n * 86_400n,
		});
		if (!result.complete) throw new Error(result.detail);
		expect(result.states.map((x) => x.listingId)).not.toContain(28_107n);
	});

	test.each([
		[
			"its seller no longer holds the miner",
			"0x6352211e",
			`0x${"0".repeat(24)}${"11".repeat(20)}`,
		],
		["the market may not move it", "0x081812fc", `0x${"0".repeat(64)}`],
	])("calls a listing not buyable when %s", async (_why, selector, answer) => {
		// Listing 28,111 (0xb102…/13,931), buyable as recorded
		const token = 13_931n.toString(16).padStart(64, "0");
		const changed = {
			...fixture,
			calls: fixture.calls.map((c) => {
				const p = (c.params as { to?: string; data?: string }[])[0];
				return c.method === "eth_call" &&
					p?.to === "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c" &&
					p.data === `${selector}${token}`
					? { ...c, result: answer }
					: c;
			}),
		};
		const result = await scan({ client: changed });
		if (!result.complete) throw new Error(result.detail);
		expect(result.states.find((x) => x.listingId === 28_111n)?.buyable).toBe(
			false,
		);
	});

	describe("and the market's code (docs/decisions/2026-11-20-market-admin-events.md)", () => {
		const UPGRADED =
			"0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";
		/** The recorded scan with Upgraded logs added to its first log read. */
		function withUpgrades(
			upgrades: { block: bigint; implementation: string }[],
		): Fixture {
			let added = false;
			return {
				...fixture,
				calls: fixture.calls.map((c) => {
					if (c.method !== "eth_getLogs" || added) return c;
					added = true;
					const logs = c.result as Record<string, unknown>[];
					const model = logs[0] as Record<string, unknown>;
					const extra = upgrades.map((u, i) => ({
						...model,
						topics: [
							UPGRADED,
							`0x${"0".repeat(24)}${u.implementation.slice(2)}`,
						],
						data: "0x",
						blockNumber: `0x${u.block.toString(16)}`,
						logIndex: `0x${(900 + i).toString(16)}`,
					}));
					return { ...c, result: [...extra, ...logs] };
				}),
			};
		}

		test("accepts the market's two known upgrades", async () => {
			const result = await scan({
				client: withUpgrades([
					{
						block: 116_708_167n,
						implementation: "0x437d0a6141079554bbaf0d507ac3070c06576647",
					},
					{
						block: 116_709_020n,
						implementation: "0x725771c38361abef7b844729b978c775f7a83dfb",
					},
				]),
			});
			expect(result.complete).toBe(true);
		});

		test.each([
			["new code", 134_700_000n, `0x${"12".repeat(20)}`],
			[
				"other code at a known upgrade's block",
				116_709_020n,
				`0x${"12".repeat(20)}`,
			],
			[
				"the known code again, at another block",
				134_700_000n,
				"0x725771c38361abef7b844729b978c775f7a83dfb",
			],
		])(
			"stops at an upgrade it doesn't know: %s",
			async (_name, block, implementation) => {
				const result = await scan({
					client: withUpgrades([{ block, implementation }]),
				});
				expect(result).toEqual({
					complete: false,
					detail: expect.stringContaining(`upgraded at block ${block}`),
				});
			},
		);

		test("stops when the market's code at the end block isn't the confirmed one", async () => {
			const changed: Fixture = {
				...fixture,
				calls: fixture.calls.map((c) =>
					c.method === "eth_getStorageAt"
						? { ...c, result: `0x${"0".repeat(24)}${"34".repeat(20)}` }
						: c,
				),
			};
			const result = await scan({ client: changed });
			expect(result).toEqual({
				complete: false,
				detail: expect.stringContaining(
					"0x3434343434343434343434343434343434343434",
				),
			});
		});
	});
});
