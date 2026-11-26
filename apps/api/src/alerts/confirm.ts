// Telling a chat its Foreman Pro payment counted (docs/decisions/2026-11-26-pro-payments.md, decision
// 5). The API records a payment the page reports but holds no bot token, so the worker sends this,
// every 30 seconds and after each run: one message per chat, naming when its Pro now ends. A message
// Telegram doesn't take is tried again; a chat that blocked the bot is marked told and not tried again.

import {
	markProPaymentsTold,
	readProUntil,
	readUntoldProPayments,
	type UntoldProPayment,
} from "@foreman/index";
import type pg from "pg";
import { PRO_FOLLOWS } from "./bot.ts";
import { formatDay } from "./message.ts";
import type { TelegramClient } from "./telegram.ts";

export async function sendProConfirmations(
	deps: { pool: pg.Pool; telegram: TelegramClient },
	log: (line: string) => void = console.log,
): Promise<{ sent: number; failed: number }> {
	const summary = { sent: 0, failed: 0 };
	const byChat = new Map<bigint, UntoldProPayment[]>();
	for (const p of await readUntoldProPayments(deps.pool)) {
		byChat.set(p.chatId, [...(byChat.get(p.chatId) ?? []), p]);
	}
	for (const [chatId, payments] of byChat) {
		const until = await readProUntil(deps.pool, chatId);
		if (!until) continue;
		const result = await deps.telegram.sendMessage(
			chatId,
			`Payment counted: Foreman Pro until ${formatDay(until)}. This chat can now follow up to ${PRO_FOLLOWS} addresses. Send /follow 0x… to add one.`,
		);
		if (result.ok || result.blocked) {
			await markProPaymentsTold(deps.pool, payments);
			if (result.ok) summary.sent += 1;
		} else {
			log(`pro: chat ${chatId} wasn't told of its payment: ${result.detail}`);
			summary.failed += 1;
		}
	}
	return summary;
}
