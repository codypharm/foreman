import { proCode, readFollows } from "@foreman/index";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { MARKET, OTHER, setUp, WALLET } from "../page/wallet-fixture.ts";
import { HELP, handleCommand, PRO_FOLLOWS } from "./bot.ts";
import { NOW, payFor } from "./pro-fixture.ts";

// The bot's commands (docs/decisions/2026-11-23-copy-alert-notifications.md, decisions 2, 4 and 10;
// 2026-11-26-telegram-alerts-for-pro.md, decision 2), on the wallet page's fixture market.

const CHAT = 7n;
const WEB = "https://foreman.example/";

/** n distinct addresses */
const addresses = (n: number) =>
	Array.from(
		{ length: n },
		(_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`,
	);

describe.skipIf(!TEST_DATABASE_URL)("the Telegram bot's commands", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	const deps = () => ({
		pool: pool as pg.Pool,
		now: () => NOW,
		webUrl: WEB,
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

	test("/pro without Pro says what it gives, the test amount, and this chat's pay link", async () => {
		pool = await setUp();
		const code = await proCode(pool, CHAT);
		const reply = await handleCommand(deps(), CHAT, "/pro");
		expect(reply).toMatch(/follows 0 of 1 address/);
		expect(reply).toMatch(/up to 20 addresses for 30 days/);
		expect(reply).toMatch(/0\.01 test OKB on the X Layer testnet/);
		expect(reply).toMatch(/real price isn't set/);
		expect(reply).toContain(`https://foreman.example/#/pro/${code.slice(2)}`);
		// A refused second follow points to /pro
		await handleCommand(deps(), CHAT, `/follow ${WALLET}`);
		expect(await handleCommand(deps(), CHAT, `/follow ${OTHER}`)).toMatch(
			/the most without Foreman Pro\. Send \/pro/,
		);
	});

	test("with Pro a chat follows up to 20 until it ends, and /pro says until when", async () => {
		pool = await setUp();
		await payFor(pool, CHAT, 1); // ends 29 days from NOW: 26 Dec 2026, 12:00 UTC
		const many = addresses(PRO_FOLLOWS + 1);
		for (const a of many.slice(0, PRO_FOLLOWS)) {
			expect(await handleCommand(deps(), CHAT, `/follow ${a}`)).toMatch(
				/^Following/,
			);
		}
		expect(
			await handleCommand(deps(), CHAT, `/follow ${many[PRO_FOLLOWS]}`),
		).toMatch(/already follows 20 addresses, the most it can/);
		const reply = await handleCommand(deps(), CHAT, "/pro");
		expect(reply).toMatch(/^Foreman Pro until 26 Dec 2026/);
		expect(reply).toMatch(/follows 20 of 20 addresses/);
		expect(reply).toMatch(/Paying again adds 30 days/);
	});

	test("once Pro ends, a chat keeps its follows but can't add one, and /pro says when it ended", async () => {
		pool = await setUp();
		await payFor(pool, CHAT, 40); // ended 10 days before NOW: 17 Nov 2026
		const [a, b] = addresses(2);
		expect(await handleCommand(deps(), CHAT, `/follow ${a}`)).toMatch(
			/^Following/,
		);
		expect(await handleCommand(deps(), CHAT, `/follow ${b}`)).toMatch(
			/the most without Foreman Pro/,
		);
		expect(await handleCommand(deps(), CHAT, "/pro")).toMatch(
			/^Foreman Pro ended on 17 Nov 2026/,
		);
	});
});
