import { readFollows } from "@foreman/index";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { MARKET, OTHER, setUp, WALLET } from "../page/wallet-fixture.ts";
import { FREE_FOLLOWS, HELP, handleCommand } from "./bot.ts";

// The bot's commands (docs/decisions/2026-11-23-copy-alert-notifications.md, decisions 2, 4 and 10;
// 2026-11-26-telegram-alerts-for-pro.md, decision 2), on the wallet page's fixture market.

const CHAT = 7n;

describe.skipIf(!TEST_DATABASE_URL)("the Telegram bot's commands", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	const deps = () => ({
		pool: pool as pg.Pool,
		limitFor: async () => FREE_FOLLOWS,
	});

	test("a deep link follows from the market's current block; a second address needs Pro", async () => {
		pool = await setUp();
		expect(
			await handleCommand(
				deps(),
				CHAT,
				`/start ${WALLET.toUpperCase().replace("0X", "0x")}`,
			),
		).toMatch(/^Following 0x2ef2…49ef\. /);
		expect(await readFollows(pool, CHAT)).toEqual([
			{ chatId: CHAT, address: WALLET, followedAtBlock: MARKET.block },
		]);
		expect(
			await handleCommand(deps(), CHAT, `/follow@ForemanBot ${WALLET}`),
		).toBe("This chat already follows 0x2ef2…49ef.");
		expect(await handleCommand(deps(), CHAT, `/follow ${OTHER}`)).toMatch(
			/the most without Foreman Pro/,
		);
		expect(await handleCommand(deps(), CHAT, "/list")).toBe(
			`This chat follows:\n${WALLET}`,
		);
	});

	test("anything that isn't an address or a command gets the help, never a lookup", async () => {
		pool = await setUp();
		expect(await handleCommand(deps(), CHAT, "/follow 1234")).toMatch(
			/isn't an address/,
		);
		expect(await handleCommand(deps(), CHAT, "is circuit 5607 a copy?")).toBe(
			HELP,
		);
		expect(await handleCommand(deps(), CHAT, "/stop")).toMatch(/^Stopped\./);
		expect(await readFollows(pool, CHAT)).toEqual([]);
	});
});
