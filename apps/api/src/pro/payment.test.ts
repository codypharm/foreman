import {
	foremanProAbi,
	PRO_PRICE_WEI,
	proCodeWord,
} from "@foreman/chain-xlayer/pro";
import {
	parseAddress,
	parseApiError,
	parseHex32,
	parseProPaymentAnswer,
} from "@foreman/contract";
import { proCode, readProUntil } from "@foreman/index";
import { freshDatabase, TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { encodeFunctionData, type WalletClient } from "viem";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	FOUNDRY,
	type LocalChain,
	localChain,
} from "../publish/local-xlayer.ts";
import { createApp } from "../server/app.ts";
import { checkProPayment } from "./payment.ts";

// The API's check of a reported Foreman Pro payment (docs/decisions/2026-11-26-pro-payments.md,
// decision 5), on a local X Layer testnet running the compiled ForemanPro: only a successful payment
// of exactly the amount, to the confirmed contract, counts, and only once.

const CHAT = 5_550_001n;
const DAY = 86_400;

describe.skipIf(!TEST_DATABASE_URL || !FOUNDRY)(
	"checking a Pro payment",
	() => {
		let local: LocalChain;
		let pool: pg.Pool;
		let pro: `0x${string}`;
		let elsewhere: `0x${string}`;
		let payer: WalletClient;

		beforeAll(async () => {
			local = await localChain();
			const [owner, , p] = local.wallets as [
				WalletClient,
				WalletClient,
				WalletClient,
			];
			payer = p;
			const inputs = [{ name: "owner_", type: "address" }];
			pro = await local.deploy(
				"ForemanPro",
				inputs,
				[owner.account?.address],
				owner,
			);
			// Another ForemanPro: the same code at an address Foreman doesn't use
			elsewhere = await local.deploy(
				"ForemanPro",
				inputs,
				[owner.account?.address],
				owner,
			);
			pool = await freshDatabase();
		}, 60_000);
		afterAll(async () => {
			await pool?.end();
			await local?.stop();
		});

		const chain = () => ({ client: local.publicClient, contract: pro });

		async function pay(code: `0x${string}`, to = pro, value = PRO_PRICE_WEI) {
			const account = payer.account;
			if (!account) throw new Error("no payer");
			const hash = await payer.sendTransaction({
				account,
				chain: payer.chain,
				to,
				value,
				data: encodeFunctionData({
					abi: foremanProAbi,
					functionName: "pay",
					args: [code],
				}),
				// A fixed gas limit, so a payment the contract refuses is still mined, as a failed transaction
				gas: 100_000n,
			});
			await local.publicClient.waitForTransactionReceipt({ hash });
			return parseHex32(hash, "tx");
		}

		test("the amount in the ABI is the contract's", async () => {
			expect(
				await local.publicClient.readContract({
					address: pro,
					abi: foremanProAbi,
					functionName: "PRICE",
				}),
			).toBe(PRO_PRICE_WEI);
		});

		test("a payment for a chat's code counts once, and answers when that chat's Pro ends", async () => {
			const code = await proCode(pool, CHAT);
			const tx = await pay(proCodeWord(code));
			const first = await checkProPayment(pool, chain(), tx);
			if (!first.ok) throw new Error(first.error.detail);
			const block = await local.publicClient.getBlock({
				blockNumber: (
					await local.publicClient.getTransactionReceipt({ hash: tx })
				).blockNumber,
			});
			const until = new Date(
				Number(block.timestamp + 30n * BigInt(DAY)) * 1000,
			);
			expect(first).toEqual({ ok: true, counted: 1, proUntil: until });
			expect(await readProUntil(pool, CHAT)).toEqual(until);

			// The page and the worker both report it: nothing more is counted
			expect(await checkProPayment(pool, chain(), tx)).toEqual({
				ok: true,
				counted: 0,
				proUntil: until,
			});
		});

		test("a payment for a code that's no chat's is kept, with no chat's Pro to answer", async () => {
			const tx = await pay(proCodeWord(`0x${"cd".repeat(16)}`));
			expect(await checkProPayment(pool, chain(), tx)).toEqual({
				ok: true,
				counted: 1,
				proUntil: null,
			});
		});

		test("a payment elsewhere, a failed one, and one not yet in a block are refused, and count nothing", async () => {
			const code = proCodeWord(await proCode(pool, CHAT + 1n));
			const elsewhereTx = await pay(code, elsewhere);
			const failedTx = await pay(code, pro, PRO_PRICE_WEI - 1n);
			const unknownTx = parseHex32(`0x${"ee".repeat(32)}`, "tx");

			const refused = async (tx: typeof unknownTx) => {
				const r = await checkProPayment(pool, chain(), tx);
				if (r.ok) throw new Error("counted");
				return [r.error.error, r.error.detail];
			};
			expect(await refused(elsewhereTx)).toEqual([
				"not-recognised",
				"That transaction paid nothing to Foreman Pro.",
			]);
			expect(await refused(failedTx)).toEqual([
				"not-recognised",
				"That transaction failed, so nothing was paid.",
			]);
			expect((await refused(unknownTx))[0]).toBe("not-ready");
			expect(await readProUntil(pool, CHAT + 1n)).toBeNull();
		});

		test("POST /pro/payments answers the chat's Pro end to the page; a bad body or no Pro set up is refused", async () => {
			const app = (withPro: boolean) =>
				createApp({
					pool,
					bnb: local.publicClient,
					xlayer: local.publicClient,
					results: {
						chainId: 1952,
						address: parseAddress(
							"0xe1b2343d3da66afec740c0fcaf40a701e2d513e8",
							"c",
						),
					},
					resultContext: async () => ({ ready: false, detail: "not used" }),
					...(withPro ? { pro: chain() } : {}),
				});
			const post = (withPro: boolean, body: unknown) =>
				app(withPro).request("/pro/payments", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "https://foreman.example",
					},
					body: JSON.stringify(body),
				});

			const tx = await pay(proCodeWord(await proCode(pool, CHAT + 2n)));
			const res = await post(true, { txHash: tx });
			expect(res.status).toBe(200);
			// The Pro page reports it from the browser
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
			const answer = parseProPaymentAnswer(await res.json(), "body");
			expect(answer.txHash).toBe(tx);
			expect(answer.proUntil).toBe(
				BigInt(
					Math.floor(
						((await readProUntil(pool, CHAT + 2n)) as Date).getTime() / 1000,
					),
				),
			);

			const bad = await post(true, { txHash: "0x12" });
			expect(bad.status).toBe(400);
			expect(parseApiError(await bad.json(), "e").error).toBe("not-recognised");
			const off = await post(false, { txHash: tx });
			expect(off.status).toBe(503);
			expect(parseApiError(await off.json(), "e").error).toBe("not-ready");
		});
	},
);
