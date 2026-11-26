import { followAddress, readFollows } from "@foreman/index";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { OTHER, setUp, WALLET, xlayer } from "../page/wallet-fixture.ts";
import { NOW, payFor } from "./pro-fixture.ts";
import { sendAlerts } from "./send.ts";
import type { SendResult, TelegramClient } from "./telegram.ts";

// Sending alerts (docs/decisions/2026-11-23-copy-alert-notifications.md, decision 3): each listing is
// sent to a chat at most once, and a chat that blocked the bot is forgotten. On the wallet page's
// fixture, followed from block 0: three designs have copies listed.

const CHAT = 42n;

function fakeTelegram(
	reply: (chatId: bigint) => SendResult = () => ({ ok: true }),
) {
	const sent: { chatId: bigint; text: string }[] = [];
	const client: TelegramClient = {
		getUpdates: async () => [],
		sendMessage: async (chatId, text) => {
			const r = reply(chatId);
			if (r.ok) sent.push({ chatId, text });
			return r;
		},
	};
	return { client, sent };
}

describe.skipIf(!TEST_DATABASE_URL)("sending Telegram alerts", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("each listing is sent to a chat once: the next run sends nothing new", async () => {
		pool = await setUp();
		await followAddress(pool, {
			chatId: CHAT,
			address: WALLET,
			atBlock: 0n,
			limit: 1,
		});
		const telegram = fakeTelegram();
		const deps = {
			pool,
			xlayer: xlayer(),
			telegram: telegram.client,
			webUrl: "https://foreman.example",
			now: () => NOW,
		};

		expect(await sendAlerts(deps, () => {})).toEqual({
			sent: 3,
			failed: 0,
			stopped: 0,
			paused: 0,
		});
		expect(telegram.sent.map((m) => m.text.split(",")[0])).toEqual([
			"2 new copies of #967",
			"A new copy of #1008",
			"A new copy of #1570",
		]);
		expect(await sendAlerts(deps, () => {})).toEqual({
			sent: 0,
			failed: 0,
			stopped: 0,
			paused: 0,
		});
		expect(telegram.sent).toHaveLength(3);
	});

	test("a failed send is tried again next run; a chat that blocked the bot is forgotten", async () => {
		pool = await setUp();
		await followAddress(pool, {
			chatId: CHAT,
			address: WALLET,
			atBlock: 0n,
			limit: 1,
		});
		const deps = (telegram: TelegramClient) => ({
			pool: pool as pg.Pool,
			xlayer: xlayer(),
			telegram,
			webUrl: "https://foreman.example",
			now: () => NOW,
		});

		const down = fakeTelegram(() => ({
			ok: false,
			blocked: false,
			detail: "429 Too Many Requests",
		}));
		expect(await sendAlerts(deps(down.client), () => {})).toEqual({
			sent: 0,
			failed: 3,
			stopped: 0,
			paused: 0,
		});

		const blocked = fakeTelegram(() => ({
			ok: false,
			blocked: true,
			detail: "403 Forbidden",
		}));
		expect(await sendAlerts(deps(blocked.client), () => {})).toEqual({
			sent: 0,
			failed: 0,
			stopped: 1,
			paused: 0,
		});
		expect(await readFollows(pool, CHAT)).toEqual([]);
	});

	test("without Pro only a chat's first follow sends; copies listed while paused are never sent later", async () => {
		pool = await setUp();
		// Followed while Pro lasted: OTHER first (no miners), then WALLET (three designs with copies)
		await payFor(pool, CHAT, 40); // ran out 10 days ago
		for (const address of [OTHER, WALLET]) {
			await followAddress(pool, {
				chatId: CHAT,
				address,
				atBlock: 0n,
				limit: 20,
			});
		}
		const telegram = fakeTelegram();
		const deps = {
			pool,
			xlayer: xlayer(),
			telegram: telegram.client,
			webUrl: "https://foreman.example",
			now: () => NOW,
		};
		expect(await sendAlerts(deps, () => {})).toEqual({
			sent: 0,
			failed: 0,
			stopped: 0,
			paused: 1,
		});

		// Paying again resumes WALLET, from now on: what was listed while it was paused isn't sent
		await payFor(pool, CHAT, 0);
		expect(await sendAlerts(deps, () => {})).toEqual({
			sent: 0,
			failed: 0,
			stopped: 0,
			paused: 0,
		});
		expect(telegram.sent).toEqual([]);
	});

	test("with Pro every follow sends", async () => {
		pool = await setUp();
		await payFor(pool, CHAT, 1);
		for (const address of [OTHER, WALLET]) {
			await followAddress(pool, {
				chatId: CHAT,
				address,
				atBlock: 0n,
				limit: 20,
			});
		}
		const telegram = fakeTelegram();
		expect(
			await sendAlerts(
				{
					pool,
					xlayer: xlayer(),
					telegram: telegram.client,
					webUrl: "https://foreman.example",
					now: () => NOW,
				},
				() => {},
			),
		).toEqual({ sent: 3, failed: 0, stopped: 0, paused: 0 });
	});
});
