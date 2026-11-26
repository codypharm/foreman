// Foreman Pro in tests (docs/decisions/2026-11-26-pro-payments.md): a counted payment made for a chat.

import { proCode, recordProPayment } from "@foreman/index";
import type pg from "pg";

export const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const DAY_MS = 86_400_000;

/** Pays for the chat's Pro `daysAgo` before NOW (negative: after), one transaction per chat and day, as a counted payment. */
export async function payFor(pool: pg.Pool, chatId: bigint, daysAgo: number) {
	const code = await proCode(pool, chatId);
	await recordProPayment(pool, {
		txHash: `0x${chatId.toString(16).padStart(32, "0")}${(daysAgo + 1_000).toString(16).padStart(32, "0")}`,
		logIndex: 0,
		block: 47_250_000n - BigInt(daysAgo * 86_400),
		paidAt: new Date(NOW - daysAgo * DAY_MS),
		code: `${code}${"0".repeat(32)}`,
		payer: "0x2ef2fed3f9b3d5385499008051031320b1fb49ef",
		amount: 10_000_000_000_000_000n,
	});
	return code;
}
