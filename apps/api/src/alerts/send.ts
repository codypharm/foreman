// Sends Telegram copy alerts after a worker run (docs/decisions/2026-11-23-copy-alert-notifications.md,
// decisions 3 and 5): each followed address's wallet page, the copies new to each chat, one message per
// design. A listing is recorded as sent only once Telegram accepts the message, so a failed send is
// tried again next run. A chat that blocked the bot is forgotten. Without Foreman Pro only a chat's
// first follow sends; the rest are paused, and the copies listed while paused are marked as sent
// without a message, so paying again never sends them later (2026-11-26-pro-payments.md, decision 6).

import { parseAddress } from "@foreman/contract";
import {
	readFollows,
	readProUntil,
	readSent,
	recordSent,
	stopChat,
} from "@foreman/index";
import type pg from "pg";
import type { PublicClient } from "viem";
import { readWalletMiners, type WalletRead } from "../page/wallet-page.ts";
import { alertMessage, shortAddress } from "./message.ts";
import { planAlerts } from "./plan.ts";
import type { TelegramClient } from "./telegram.ts";

export interface SendDeps {
	pool: pg.Pool;
	/** X Layer mainnet, for the RIG vouchers an address holds. */
	xlayer: PublicClient;
	telegram: TelegramClient;
	/** The web app's address, for the result page links. */
	webUrl: string;
	now: () => number;
}

export interface SendSummary {
	sent: number;
	failed: number;
	/** Chats forgotten because they blocked the bot. */
	stopped: number;
	/** Follows paused because their chat has no Pro. */
	paused: number;
}

export async function sendAlerts(
	deps: SendDeps,
	log: (line: string) => void = console.log,
): Promise<SendSummary> {
	const summary: SendSummary = { sent: 0, failed: 0, stopped: 0, paused: 0 };
	const pages = new Map<string, WalletRead>();
	const stopped = new Set<bigint>();
	// Follows come oldest first within each chat, so the first seen is the one that never pauses
	const firstSeen = new Set<bigint>();
	const hasPro = new Map<bigint, boolean>();
	for (const follow of await readFollows(deps.pool)) {
		if (stopped.has(follow.chatId)) continue;
		const first = !firstSeen.has(follow.chatId);
		firstSeen.add(follow.chatId);
		let pro = hasPro.get(follow.chatId);
		if (pro === undefined) {
			const until = await readProUntil(deps.pool, follow.chatId);
			pro = until !== null && until.getTime() > deps.now();
			hasPro.set(follow.chatId, pro);
		}
		const paused = !first && !pro;
		let read = pages.get(follow.address);
		if (!read) {
			read = await readWalletMiners(
				deps,
				parseAddress(follow.address, "followed address"),
			);
			pages.set(follow.address, read);
		}
		if (!read.ok) {
			log(
				`alerts: ${shortAddress(follow.address)} not read: ${read.error.detail}`,
			);
			continue;
		}
		const sent = await readSent(deps.pool, follow.chatId);
		const alerts = planAlerts(read.page, follow, sent);
		if (paused) {
			await recordSent(
				deps.pool,
				follow.chatId,
				alerts.flatMap((a) => a.copies.map((c) => c.listing.listingId)),
			);
			summary.paused += 1;
			continue;
		}
		for (const alert of alerts) {
			const result = await deps.telegram.sendMessage(
				follow.chatId,
				alertMessage(alert, deps.webUrl),
			);
			if (result.ok) {
				await recordSent(
					deps.pool,
					follow.chatId,
					alert.copies.map((c) => c.listing.listingId),
				);
				summary.sent += 1;
			} else if (result.blocked) {
				await stopChat(deps.pool, follow.chatId);
				stopped.add(follow.chatId);
				summary.stopped += 1;
				break;
			} else {
				log(`alerts: a message wasn't sent: ${result.detail}`);
				summary.failed += 1;
			}
		}
	}
	return summary;
}
