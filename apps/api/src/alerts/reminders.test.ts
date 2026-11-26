import { followAddress, stopChat } from "@foreman/index";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { OTHER, setUp, WALLET } from "../page/wallet-fixture.ts";
import { NOW, payFor } from "./pro-fixture.ts";
import { sendProReminders } from "./reminders.ts";
import type { TelegramClient } from "./telegram.ts";

// Foreman Pro's two reminders (docs/decisions/2026-11-26-pro-payments.md, decision 6): 3 days before it
// ends and once it has ended, each sent once per end date, with the chat's pay link.

const CHAT = 42n;
const DAY_MS = 86_400_000;

function fakeTelegram() {
	const sent: { chatId: bigint; text: string }[] = [];
	const client: TelegramClient = {
		getUpdates: async () => [],
		sendMessage: async (chatId, text) => {
			sent.push({ chatId, text });
			return { ok: true };
		},
	};
	return { client, sent };
}

describe.skipIf(!TEST_DATABASE_URL)("Foreman Pro reminders", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("one reminder 3 days before the end and one once it has ended; a renewal starts them again", async () => {
		pool = await setUp();
		const code = await payFor(pool, CHAT, 28); // ends 2 days after NOW: 29 Nov 2026
		for (const address of [WALLET, OTHER]) {
			await followAddress(pool, {
				chatId: CHAT,
				address,
				atBlock: 0n,
				limit: 20,
			});
		}
		const telegram = fakeTelegram();
		let now = NOW;
		const deps = {
			pool,
			telegram: telegram.client,
			webUrl: "https://foreman.example",
			now: () => now,
		};

		expect(await sendProReminders(deps, () => {})).toEqual({
			sent: 1,
			failed: 0,
		});
		expect(telegram.sent[0]?.text).toMatch(
			/^Foreman Pro ends on 29 Nov 2026\./,
		);
		expect(telegram.sent[0]?.text).toMatch(
			/only 0x2ef2…49ef sends alerts; 1 other followed address pauses/,
		);
		expect(telegram.sent[0]?.text).toContain(
			`https://foreman.example/#/pro/${code.slice(2)}`,
		);
		expect(await sendProReminders(deps, () => {})).toEqual({
			sent: 0,
			failed: 0,
		});

		now = NOW + 3 * DAY_MS; // a day after the end
		expect(await sendProReminders(deps, () => {})).toEqual({
			sent: 1,
			failed: 0,
		});
		expect(telegram.sent[1]?.text).toMatch(
			/^Foreman Pro ended on 29 Nov 2026\./,
		);
		expect(telegram.sent[1]?.text).toMatch(
			/1 other followed address is paused/,
		);
		expect(await sendProReminders(deps, () => {})).toEqual({
			sent: 0,
			failed: 0,
		});

		// Paid again a day after it ended (30 Nov), to 30 Dec: the new end gets its own reminders
		await payFor(pool, CHAT, -3);
		now = NOW + 30 * DAY_MS;
		expect(await sendProReminders(deps, () => {})).toEqual({
			sent: 1,
			failed: 0,
		});
		expect(telegram.sent[2]?.text).toMatch(
			/^Foreman Pro ends on 30 Dec 2026\./,
		);
	});

	test("no reminder for a chat more than 3 days from its end, or one that sent /stop", async () => {
		pool = await setUp();
		await payFor(pool, CHAT, 20); // ends 10 days after NOW
		await followAddress(pool, {
			chatId: CHAT,
			address: WALLET,
			atBlock: 0n,
			limit: 20,
		});
		await payFor(pool, 43n, 28); // ends in 2 days, but the chat stopped
		const telegram = fakeTelegram();
		await stopChat(pool, 43n);
		expect(
			await sendProReminders(
				{
					pool,
					telegram: telegram.client,
					webUrl: "https://foreman.example",
					now: () => NOW,
				},
				() => {},
			),
		).toEqual({ sent: 0, failed: 0 });
	});
});
