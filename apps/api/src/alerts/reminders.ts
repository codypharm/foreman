// Foreman Pro's reminders (docs/decisions/2026-11-26-pro-payments.md, decision 6): 3 days before a
// chat's Pro ends, and once it has ended, each sent once per end date with the chat's pay link. A
// chat that sent /stop, and so follows nothing, gets none. A reminder is recorded only once Telegram
// accepts it, so a failed send is tried again next run.

import {
	PRO_DAYS,
	proReminderSent,
	readFollows,
	readProChats,
	readProUntil,
	recordProReminder,
	stopChat,
} from "@foreman/index";
import type pg from "pg";
import { payLink } from "./bot.ts";
import { formatDay, shortAddress } from "./message.ts";
import type { TelegramClient } from "./telegram.ts";

const ENDING_MS = 3 * 86_400_000;

export interface ReminderDeps {
	pool: pg.Pool;
	telegram: TelegramClient;
	/** The web app's address, for the pay link. */
	webUrl: string;
	now: () => number;
}

export async function sendProReminders(
	deps: ReminderDeps,
	log: (line: string) => void = console.log,
): Promise<{ sent: number; failed: number }> {
	const summary = { sent: 0, failed: 0 };
	const now = deps.now();
	for (const chatId of await readProChats(deps.pool)) {
		const follows = await readFollows(deps.pool, chatId);
		const first = follows[0];
		const until = await readProUntil(deps.pool, chatId);
		if (!first || !until) continue;
		const ended = now >= until.getTime();
		if (!ended && now < until.getTime() - ENDING_MS) continue;
		const kind = ended ? "ended" : "ending";
		if (await proReminderSent(deps.pool, chatId, until, kind)) continue;

		const others = follows.length - 1;
		const day = formatDay(until);
		const who = shortAddress(first.address);
		const link = await payLink(deps, chatId);
		const othersWord = `${others} other followed ${others === 1 ? "address" : "addresses"}`;
		const text = ended
			? [
					`Foreman Pro ended on ${day}. Only ${who} sends alerts${others > 0 ? `; ${othersWord} ${others === 1 ? "is" : "are"} paused, and copies listed while paused aren't sent` : ""}.`,
					"",
					`Paying again resumes Foreman Pro for ${PRO_DAYS} days:`,
					link,
				].join("\n")
			: [
					`Foreman Pro ends on ${day}. After that only ${who} sends alerts${others > 0 ? `; ${othersWord} ${others === 1 ? "pauses" : "pause"} until Pro is paid again` : ""}.`,
					"",
					`To add ${PRO_DAYS} days, for 0.01 test OKB on the X Layer testnet:`,
					link,
				].join("\n");
		const result = await deps.telegram.sendMessage(chatId, text);
		if (result.ok) {
			await recordProReminder(deps.pool, chatId, until, kind);
			summary.sent += 1;
		} else if (result.blocked) {
			await stopChat(deps.pool, chatId);
		} else {
			log(`pro: a reminder to chat ${chatId} wasn't sent: ${result.detail}`);
			summary.failed += 1;
		}
	}
	return summary;
}
