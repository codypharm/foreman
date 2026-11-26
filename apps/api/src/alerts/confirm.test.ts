import { proCode, recordProPayment } from "@foreman/index";
import { freshDatabase, TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { sendProConfirmations } from "./confirm.ts";
import { NOW, payFor } from "./pro-fixture.ts";
import type { SendResult, TelegramClient } from "./telegram.ts";

// Telling a chat its Foreman Pro payment counted (docs/decisions/2026-11-26-pro-payments.md, decision
// 5): one message per chat for the payments it hasn't been told about, naming when Pro now ends.

const CHAT = 42n;

function fakeTelegram(reply: () => SendResult = () => ({ ok: true })) {
	const sent: { chatId: bigint; text: string }[] = [];
	const client: TelegramClient = {
		getUpdates: async () => [],
		sendMessage: async (chatId, text) => {
			const r = reply();
			if (r.ok) sent.push({ chatId, text });
			return r;
		},
	};
	return { client, sent };
}

describe.skipIf(!TEST_DATABASE_URL)(
	"telling a chat its Pro payment counted",
	() => {
		let pool: pg.Pool | undefined;
		afterEach(async () => {
			await pool?.end();
			pool = undefined;
		});

		test("one message per chat for its new payments, once; a code that's no chat's tells no one", async () => {
			pool = await freshDatabase();
			await payFor(pool, CHAT, 1); // to 26 Dec 2026
			await payFor(pool, CHAT, 0); // to 25 Jan 2027
			await recordProPayment(pool, {
				txHash: `0x${"ab".repeat(32)}`,
				logIndex: 0,
				block: 1n,
				paidAt: new Date(NOW),
				code: `0x${"cd".repeat(16)}${"0".repeat(32)}`,
				payer: "0x2ef2fed3f9b3d5385499008051031320b1fb49ef",
				amount: 10n ** 16n,
			});
			const telegram = fakeTelegram();
			expect(
				await sendProConfirmations(
					{ pool, telegram: telegram.client },
					() => {},
				),
			).toEqual({
				sent: 1,
				failed: 0,
			});
			expect(telegram.sent).toEqual([
				{
					chatId: CHAT,
					text: "Payment counted: Foreman Pro until 25 Jan 2027. This chat can now follow up to 20 addresses. Send /follow 0x… to add one.",
				},
			]);
			expect(
				await sendProConfirmations(
					{ pool, telegram: telegram.client },
					() => {},
				),
			).toEqual({
				sent: 0,
				failed: 0,
			});
		});

		test("a message Telegram doesn't take is tried again; a chat that blocked the bot isn't", async () => {
			pool = await freshDatabase();
			await proCode(pool, CHAT);
			await payFor(pool, CHAT, 0);
			const down = fakeTelegram(() => ({
				ok: false,
				blocked: false,
				detail: "429",
			}));
			expect(
				await sendProConfirmations({ pool, telegram: down.client }, () => {}),
			).toEqual({
				sent: 0,
				failed: 1,
			});
			const blocked = fakeTelegram(() => ({
				ok: false,
				blocked: true,
				detail: "403",
			}));
			expect(
				await sendProConfirmations(
					{ pool, telegram: blocked.client },
					() => {},
				),
			).toEqual({
				sent: 0,
				failed: 0,
			});
			const up = fakeTelegram();
			expect(
				await sendProConfirmations({ pool, telegram: up.client }, () => {}),
			).toEqual({
				sent: 0,
				failed: 0,
			});
		});
	},
);
