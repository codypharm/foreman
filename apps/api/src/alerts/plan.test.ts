import { TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { setUp, WALLET, walletPage } from "../page/wallet-fixture.ts";
import { alertMessage } from "./message.ts";
import { planAlerts } from "./plan.ts";

// Which copies a Telegram chat is told about (docs/decisions/2026-11-23-copy-alert-notifications.md,
// decision 3): only listings after the address was followed and after the miner came to it, each
// listing once per chat, one message per design per run. On the wallet page's fixture: WALLET's
// alerts are 967 (copies 2397 and 1784 listed), 1008 and 1144, one design (1147 listed; 1144 is
// WALLET's own listing), and 1570 (1510 listed).

const CHAT = 42n;
const listingIds = (alerts: Awaited<ReturnType<typeof planAlerts>>) =>
	alerts.map((a) => a.copies.map((c) => Number(c.listing.listingId)));

describe.skipIf(!TEST_DATABASE_URL)("planning Telegram alerts", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("one alert per design, each listing once, naming the first held miner of the design", async () => {
		pool = await setUp();
		const page = await walletPage(pool);
		const alerts = planAlerts(
			page,
			{ chatId: CHAT, address: WALLET, followedAtBlock: 0n },
			new Set(),
		);
		expect(alerts.map((a) => Number(a.held.tokenId))).toEqual([
			967, 1008, 1570,
		]);
		expect(listingIds(alerts)).toEqual([[30_001, 30_002], [30_003], [30_005]]);
		expect(alerts.every((a) => a.chatId === CHAT && a.address === WALLET)).toBe(
			true,
		);
	});

	test("never a listing at or before the follow, at or before the miner came to the address, or already sent", async () => {
		pool = await setUp();
		const page = await walletPage(pool);
		const block = (id: number) => {
			for (const m of page.miners) {
				const c = m.alert?.copies.find(
					(c) => c.listing.listingId === BigInt(id),
				);
				if (c) return c.listing.listedAt.block;
			}
			throw new Error(`listing ${id} isn't on the page`);
		};
		const follow = {
			chatId: CHAT,
			address: WALLET,
			followedAtBlock: block(30_005),
		};
		expect(listingIds(planAlerts(page, follow, new Set()))).toEqual([
			[30_001],
			[30_003],
		]);
		expect(listingIds(planAlerts(page, follow, new Set([30_003n])))).toEqual([
			[30_001],
		]);

		const m967 = page.miners.find((m) => m.circuit.tokenId === 967n);
		if (!m967) throw new Error("967 isn't on the page");
		m967.heldAs = { kind: "nft", ownerSince: block(30_001) };
		expect(listingIds(planAlerts(page, follow, new Set()))).toEqual([[30_003]]);
	});

	test("the message states the facts and links both result pages", async () => {
		pool = await setUp();
		const alerts = planAlerts(
			await walletPage(pool),
			{ chatId: CHAT, address: WALLET, followedAtBlock: 0n },
			new Set(),
		);
		const [two, one] = alerts.map((a) =>
			alertMessage(a, "https://foreman.example/"),
		);
		const page =
			"https://foreman.example/#/circuit/0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
		expect(two).toBe(
			[
				"2 new copies of #967, held by 0x2ef2…49ef, were listed on TapeOut's market. Newest: #2397 at 0.1 BNB, listed 21 Nov. Identical netlist, designed later.",
				"",
				`#967: ${page}/967`,
				`#2397: ${page}/2397`,
			].join("\n"),
		);
		expect(one).toBe(
			[
				"A new copy of #1008, held by 0x2ef2…49ef, was listed on TapeOut's market. #1147 at 0.1 BNB, listed 19 Nov. Identical netlist, designed later.",
				"",
				`#1008: ${page}/1008`,
				`#1147: ${page}/1147`,
			].join("\n"),
		);
		for (const m of [two, one])
			expect(m).not.toMatch(/fake|stolen|scam|your|value|should/i);
	});
});
