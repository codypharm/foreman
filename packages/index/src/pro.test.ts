import { apiPaymentCode } from "@foreman/chain-xlayer/pro";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	PRO_DAYS,
	type ProPayment,
	proCode,
	readApiPaidUntil,
	readProUntil,
	recordProPayment,
	stopChat,
} from "./index.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// Payments for Foreman Pro (docs/decisions/2026-11-26-pro-payments.md, decisions 2, 4 and 5): each
// chat's code, payments counted once, and when a chat's Pro ends.

const CHAT = 1_234_567_890n;
const OTHER = 987_654_321n;
const PAYER = "0x2ef2fed3f9b3d5385499008051031320b1fb49ef";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 27, 12, 0, 0);

/** The 32-byte code a payment carries on chain: the chat's 16 bytes, padded. */
const onChain = (code: string) => `${code}${"0".repeat(32)}` as const;

/** A Paid log: its own transaction unless one is given, at a time `days` after T0. */
function paid(code: string, days: number, tx = days, logIndex = 0): ProPayment {
	return {
		txHash: `0x${tx.toString(16).padStart(64, "0")}`,
		logIndex,
		block: 47_250_000n + BigInt(Math.round(days * 86_400)),
		paidAt: new Date(T0 + days * DAY),
		code: onChain(code) as `0x${string}`,
		payer: PAYER,
		amount: 10_000_000_000_000_000n,
	};
}

describe.skipIf(!TEST_DATABASE_URL)("Foreman Pro", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("a chat's code is 16 random bytes, the same each time it's asked, and no other chat's", async () => {
		pool = await freshDatabase();
		const code = await proCode(pool, CHAT);
		expect(code).toMatch(/^0x[0-9a-f]{32}$/);
		expect(await proCode(pool, CHAT)).toBe(code);
		expect(await proCode(pool, OTHER)).not.toBe(code);
	});

	test("a payment is counted once for the chat whose code it carries; a code that's no chat's is kept for none", async () => {
		pool = await freshDatabase();
		const code = await proCode(pool, CHAT);
		expect(await recordProPayment(pool, paid(code, 0))).toEqual({
			counted: true,
			chatId: CHAT,
		});
		// The page and the worker both report it: the second is not counted again
		expect(await recordProPayment(pool, paid(code, 0))).toEqual({
			counted: false,
			chatId: CHAT,
		});
		// Two Paid logs in one transaction are two payments
		expect(await recordProPayment(pool, paid(code, 0, 0, 1))).toEqual({
			counted: true,
			chatId: CHAT,
		});
		const stranger = `0x${"ab".repeat(16)}`;
		expect(await recordProPayment(pool, paid(stranger, 1))).toEqual({
			counted: true,
			chatId: null,
		});
		// A chat's 16 bytes not padded with zeros on chain are no chat's code
		const unpadded = {
			...paid(code, 2),
			code: `${code}${"1".repeat(32)}` as `0x${string}`,
		};
		expect(await recordProPayment(pool, unpadded)).toEqual({
			counted: true,
			chatId: null,
		});
	});

	test("each payment adds 30 days from the later of its own time and the current end", async () => {
		pool = await freshDatabase();
		expect(PRO_DAYS).toBe(30);
		const code = await proCode(pool, CHAT);
		const at = (days: number) => new Date(T0 + days * DAY);
		expect(await readProUntil(pool, CHAT)).toBeNull();

		// Recorded out of chain order, as when the worker finds a payment the page never reported
		await recordProPayment(pool, paid(code, 10)); // a renewal before the end: to day 60
		await recordProPayment(pool, paid(code, 0)); // the first: to day 30
		expect(await readProUntil(pool, CHAT)).toEqual(at(60));

		await recordProPayment(pool, paid(code, 75)); // after it ran out on day 60: from day 75
		expect(await readProUntil(pool, CHAT)).toEqual(at(105));

		// Another chat's payments, and a code that's no chat's, don't count for this one
		await recordProPayment(pool, paid(await proCode(pool, OTHER), 80));
		await recordProPayment(pool, paid(`0x${"ab".repeat(16)}`, 81));
		expect(await readProUntil(pool, CHAT)).toEqual(at(105));
		expect(await readProUntil(pool, OTHER)).toEqual(at(110));

		// /stop forgets a chat's follows, never what it paid for or its code
		await stopChat(pool, CHAT);
		expect(await readProUntil(pool, CHAT)).toEqual(at(105));
		expect(await proCode(pool, CHAT)).toBe(code);
	});

	// The paid API tier (docs/decisions/2026-11-26-paid-api-tier.md, decisions 2 to 4)
	test("a wallet's API payments add 30 days the same way, and count for no chat", async () => {
		pool = await freshDatabase();
		const wallet = "0x077ea6b4c1dfc7f7ec253d736c56898dfc192ea5";
		const forWallet = (days: number) => ({
			...paid("0x00", days, 500 + days),
			code: apiPaymentCode(wallet),
		});
		const at = (days: number) => new Date(T0 + days * DAY);
		expect(await readApiPaidUntil(pool, wallet)).toBeNull();

		expect(await recordProPayment(pool, forWallet(0))).toEqual({
			counted: true,
			chatId: null,
		});
		expect(await readApiPaidUntil(pool, wallet)).toEqual(at(30));
		await recordProPayment(pool, forWallet(10)); // a renewal before the end
		expect(await readApiPaidUntil(pool, wallet)).toEqual(at(60));
		// However the address is cased
		expect(
			await readApiPaidUntil(pool, wallet.toUpperCase().replace("0X", "0x")),
		).toEqual(at(60));

		// A chat's payment, and another wallet's, don't count for this wallet
		await recordProPayment(pool, paid(await proCode(pool, CHAT), 20));
		await recordProPayment(pool, {
			...paid("0x00", 21, 900),
			code: apiPaymentCode(PAYER),
		});
		expect(await readApiPaidUntil(pool, wallet)).toEqual(at(60));
		expect(await readApiPaidUntil(pool, PAYER)).toEqual(at(51));
	});
});
