import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	followAddress,
	readFollows,
	readSent,
	recordSent,
	stopChat,
	unfollowAddress,
} from "./index.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// Telegram chats following addresses for copy alerts (docs/decisions/2026-11-23-copy-alert-notifications.md,
// decisions 4 and 10; 2026-11-26-telegram-alerts-for-pro.md, decision 2).

const A = "0x077ea6b4c1dfc7f7ec253d736c56898dfc192ea5";
const B = "0xc1c59c6ec5d37ef390282cbf2ae2908df3dbdf98";
const CHAT = 1_234_567_890n;

describe.skipIf(!TEST_DATABASE_URL)("Telegram follows", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("a chat follows up to its limit; one more is refused, naming the limit", async () => {
		pool = await freshDatabase();
		expect(
			await followAddress(pool, {
				chatId: CHAT,
				address: A,
				atBlock: 100n,
				limit: 1,
			}),
		).toEqual({ status: "followed" });
		expect(
			await followAddress(pool, {
				chatId: CHAT,
				address: B,
				atBlock: 101n,
				limit: 1,
			}),
		).toEqual({ status: "limit", limit: 1 });
		expect(await readFollows(pool, CHAT)).toEqual([
			{ chatId: CHAT, address: A, followedAtBlock: 100n },
		]);
	});

	test("unfollowing frees the slot; stopping forgets the chat's follows and what was sent to it", async () => {
		pool = await freshDatabase();
		await followAddress(pool, {
			chatId: CHAT,
			address: A,
			atBlock: 100n,
			limit: 1,
		});
		expect(await unfollowAddress(pool, CHAT, A)).toBe(true);
		expect(await unfollowAddress(pool, CHAT, A)).toBe(false);
		expect(
			await followAddress(pool, {
				chatId: CHAT,
				address: B,
				atBlock: 101n,
				limit: 1,
			}),
		).toEqual({ status: "followed" });

		await recordSent(pool, CHAT, [28_216n, 28_111n]);
		await recordSent(pool, CHAT, [28_216n]);
		expect(await readSent(pool, CHAT)).toEqual(new Set([28_111n, 28_216n]));

		await stopChat(pool, CHAT);
		expect(await readFollows(pool, CHAT)).toEqual([]);
		expect(await readSent(pool, CHAT)).toEqual(new Set());
	});
});
