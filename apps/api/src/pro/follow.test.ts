import {
	foremanProAbi,
	PRO_PRICE_WEI,
	proCodeWord,
} from "@foreman/chain-xlayer/pro";
import { parseHex32 } from "@foreman/contract";
import { followProPayments, proCode, readProUntil } from "@foreman/index";
import { freshDatabase, TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { encodeFunctionData, type WalletClient } from "viem";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	FOUNDRY,
	type LocalChain,
	localChain,
} from "../publish/local-xlayer.ts";
import { checkProPayment } from "./payment.ts";

// The worker's backup read of Foreman Pro payments (docs/decisions/2026-11-26-pro-payments.md,
// decision 5), on a local X Layer testnet running the compiled ForemanPro: a payment whose page never
// reported it is still counted, once, and a read that fails saves nothing.

const CHAT = 6_660_001n;

describe.skipIf(!TEST_DATABASE_URL || !FOUNDRY)(
	"following Pro payments",
	() => {
		let local: LocalChain;
		let pool: pg.Pool;
		let pro: `0x${string}`;
		let payer: WalletClient;
		let deployedAt: bigint;

		beforeAll(async () => {
			local = await localChain();
			const [owner, , p] = local.wallets as [
				WalletClient,
				WalletClient,
				WalletClient,
			];
			payer = p;
			pro = await local.deploy(
				"ForemanPro",
				[{ name: "owner_", type: "address" }],
				[owner.account?.address],
				owner,
			);
			deployedAt = await local.publicClient.getBlockNumber({ cacheTime: 0 });
			pool = await freshDatabase();
		}, 60_000);
		afterAll(async () => {
			await pool?.end();
			await local?.stop();
		});

		const nodes = () => ({
			client: local.publicClient,
			logNodes: [local.publicClient],
		});

		async function pay(code: `0x${string}`) {
			const account = payer.account;
			if (!account) throw new Error("no payer");
			const hash = await payer.sendTransaction({
				account,
				chain: payer.chain,
				to: pro,
				value: PRO_PRICE_WEI,
				data: encodeFunctionData({
					abi: foremanProAbi,
					functionName: "pay",
					args: [code],
				}),
			});
			await local.publicClient.waitForTransactionReceipt({ hash });
			return parseHex32(hash, "tx");
		}

		test("payments the page never reported are counted once, and the read moves on", async () => {
			const code = proCodeWord(await proCode(pool, CHAT));
			const reported = await pay(code);
			await checkProPayment(
				pool,
				{ client: local.publicClient, contract: pro },
				reported,
			);
			await pay(code); // never reported
			const head = await local.publicClient.getBlockNumber({ cacheTime: 0 });

			const first = await followProPayments(pool, nodes(), {
				contract: pro,
				startBlock: deployedAt,
				toBlock: head,
			});
			expect(first).toEqual({
				followed: true,
				fromBlock: deployedAt,
				toBlock: head,
				counted: 1,
			});
			const until = await readProUntil(pool, CHAT);
			expect(until).not.toBeNull();

			// The next run starts after `head` and finds nothing new
			await local.publicClient.request({
				method: "anvil_mine" as never,
				params: ["0x2"] as never,
			});
			const next = await followProPayments(pool, nodes(), {
				contract: pro,
				startBlock: deployedAt,
				toBlock: head + 2n,
			});
			expect(next).toEqual({
				followed: true,
				fromBlock: head + 1n,
				toBlock: head + 2n,
				counted: 0,
			});
			expect(await readProUntil(pool, CHAT)).toEqual(until);
		});

		test("a run reads at most maxBlocks, and a failed read saves nothing", async () => {
			await local.publicClient.request({
				method: "anvil_mine" as never,
				params: ["0xa"] as never,
			});
			const head = await local.publicClient.getBlockNumber({ cacheTime: 0 });
			const before = await followProPayments(pool, nodes(), {
				contract: pro,
				startBlock: deployedAt,
				toBlock: head,
				maxBlocks: 4n,
			});
			if (before.followed !== true) throw new Error("not followed");
			expect(before.toBlock - before.fromBlock + 1n).toBe(4n);

			const broken = {
				client: local.publicClient,
				logNodes: [
					{ request: async () => Promise.reject(new Error("over rate limit")) },
				],
			};
			const failed = await followProPayments(pool, broken, {
				contract: pro,
				startBlock: deployedAt,
				toBlock: head,
				sleep: async () => {},
			});
			expect(failed.followed).toBe(false);
			// It starts again where it was
			const again = await followProPayments(pool, nodes(), {
				contract: pro,
				startBlock: deployedAt,
				toBlock: head,
			});
			expect(again).toMatchObject({
				followed: true,
				fromBlock: before.toBlock + 1n,
				toBlock: head,
			});
		});

		test("a node for another chain is refused", async () => {
			const elsewhere = {
				...nodes(),
				client: { ...local.publicClient, getChainId: async () => 196 },
			};
			expect(
				await followProPayments(pool, elsewhere as never, {
					contract: pro,
					startBlock: deployedAt,
					toBlock: deployedAt,
				}),
			).toEqual({
				followed: false,
				detail:
					"the X Layer node answers for chain 196, not the testnet (1952)",
			});
		});
	},
);
