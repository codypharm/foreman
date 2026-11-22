import { minerKey } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import { readHeldVouchers } from "@foreman/chain-xlayer";
import held from "@foreman/chain-xlayer/fixtures/xlayer-held-vouchers.json" with {
	type: "json",
};
import { parseAddress } from "@foreman/contract";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../../fixtures/circuit-page.json" with { type: "json" };
import { MINE6, P0, pageIndex } from "./page-fixture.ts";
import { COPY_ALERT_RULE, readWalletMiners } from "./wallet-page.ts";

// The wallet page (docs/data-contract.md, WalletMiners; docs/decisions/2026-11-22-wallet-miners.md)
// on the result page's fixture index and stored results, with the market at BNB block 134,900,065.
// Which circuits are identical, their tape-outs, design commitments and stored verdicts are chain
// data. The wallet's holdings and the extra listings are made up by this test to cover the alert
// rules. X Layer is the held-voucher fixture: WALLET holds no voucher there, VOUCHER_HOLDER holds
// #16 and #19.

const MARKET = {
	block: BigInt(fixture.market.block),
	time: BigInt(fixture.market.time),
};
const WALLET = parseAddress(held.noVouchers, "wallet");
const VOUCHER_HOLDER = parseAddress(held.holder, "voucher holder");
const OTHER = `0x${"ab".repeat(20)}`;
const OWNERS_UP_TO = 134_673_279n;
const DAY = 86_400n;

/** Made up: the circuits WALLET holds. P0/6534 was never started, so it isn't one of its miners. */
const HOLDS = [
	{ processor: MINE6, id: 46 }, // 1 gate, no earlier copy: below the floor
	{ processor: MINE6, id: 128 }, // too small to tell
	{ processor: MINE6, id: 967 }, // no earlier copy; 1784 and 2397 are later and identical
	{ processor: MINE6, id: 1008 }, // a copy; 1144 and 1147 are later and identical
	{ processor: MINE6, id: 1144 }, // a copy; 1147 is later, by the same address
	{ processor: MINE6, id: 1570 }, // committed before 1510, which taped out first
	{ processor: MINE6, id: 2510 }, // a copy of 2683, which the page fixture lists
	{ processor: P0, id: 6534 },
];

/** Made up: open listings, each by OTHER unless it says the wallet. */
const LISTINGS = [
	{ listingId: 30_001, processor: MINE6, id: 2397, ago: 3_600n },
	{ listingId: 30_002, processor: MINE6, id: 1784, ago: 10n * DAY },
	{ listingId: 30_003, processor: MINE6, id: 1147, ago: 2n * DAY },
	{ listingId: 30_004, processor: MINE6, id: 1144, ago: DAY, seller: WALLET },
	{ listingId: 30_005, processor: MINE6, id: 1510, ago: 3n * DAY },
	{ listingId: 30_006, processor: P0, id: 5388, ago: DAY },
];

async function setUp(options: { ownersFollowed?: boolean } = {}) {
	const pool = await pageIndex({
		bnb: replayClient(fixture.bnb),
		market: MARKET,
		networkDays: fixture.networkDays,
	});
	for (const [i, c] of HOLDS.entries()) {
		await pool.query(
			`insert into circuit_owners (processor, id, owner, block, tx_index, log_index)
			 values ($1, $2, $3, $4, 0, 0)`,
			[c.processor, c.id, WALLET, 130_000_000 + i],
		);
	}
	if (options.ownersFollowed ?? true) {
		await pool.query("update index_state set owners_up_to_block = $1", [
			OWNERS_UP_TO.toString(),
		]);
	}
	for (const l of LISTINGS) {
		// About 3 seconds a block on BNB Chain; only the time decides "just listed"
		const blocksAgo = l.ago / 3n;
		await pool.query(
			// Its miner state, made up and read at the market block: stopped, no weight (unused here)
			`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
			   price_wei, fee_bps, listed_block, listed_time, state_read_at_block, buyable, miner_status,
			   miner_task_id, miner_verif_weight, miner_unver_weight, miner_weight_without_bonus)
			 values ($1, $2, true, $3, $4, $5, $6, 100, $7, $8, $2, true, 0, 0, 0, 0, 0)`,
			[
				l.listingId,
				MARKET.block.toString(),
				l.seller ?? OTHER,
				l.processor,
				l.id,
				(10n ** 17n).toString(),
				(MARKET.block - blocksAgo).toString(),
				(MARKET.time - l.ago).toString(),
			],
		);
	}
	return pool;
}

const xlayer = () => replayClient(held);

async function walletPage(pool: pg.Pool, wallet = WALLET) {
	const read = await readWalletMiners({ pool, xlayer: xlayer() }, wallet);
	if (!read.ok) throw new Error(read.error.detail);
	return read.page;
}

const ids = (circuits: { circuit: { tokenId: bigint } }[]) =>
	circuits.map((c) => Number(c.circuit.tokenId));

describe.skipIf(!TEST_DATABASE_URL)("the wallet page", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("lists every started miner the wallet holds, in any state, alerts first, then by circuit", async () => {
		pool = await setUp();
		const page = await walletPage(pool);
		expect(page.wallet).toBe(WALLET);
		expect(page.owners).toEqual({ chainId: 56, upToBlock: OWNERS_UP_TO });
		expect(page.market.upTo).toEqual({ chainId: 56, ...MARKET });
		expect(page.vouchers).toMatchObject({
			chainId: 196,
			block: BigInt(held.block),
		});
		expect(ids(page.miners)).toEqual([967, 1008, 1144, 1570, 46, 128, 2510]);
		expect(page.miners.map((m) => m.alert !== null)).toEqual([
			true,
			true,
			true,
			true,
			false,
			false,
			false,
		]);
		const m967 = page.miners[0];
		expect(m967?.heldAs).toEqual({ kind: "nft", ownerSince: 130_000_002n });
		expect(m967?.minerKey).toBe(minerKey({ processor: MINE6, id: 967n }));
		expect(m967?.multiplier).toBe(6);
		expect(page.miners.every((m) => m.check.state === "checked")).toBe(true);
	});

	test("an alert lists the open listings of later identical circuits, newest first, marking those from the last 7 days", async () => {
		pool = await setUp();
		const alert = (await walletPage(pool)).miners[0]?.alert;
		expect(ids(alert?.copies ?? [])).toEqual([2397, 1784]);
		expect(alert?.copies.map((c) => c.justListed)).toEqual([true, false]);
		expect(alert?.copies.map((c) => c.sameAddress)).toEqual([false, false]);
		expect(alert?.rule).toBe(COPY_ALERT_RULE);
		expect(COPY_ALERT_RULE).toBe(
			"Open listings of later identical circuits, at or above 4 gates, not listed by this wallet",
		);
	});

	test("later means designed later: a circuit taped out first but committed after the miner is in its alert", async () => {
		pool = await setUp();
		const m1570 = (await walletPage(pool)).miners.find(
			(m) => m.circuit.tokenId === 1570n,
		);
		expect(ids(m1570?.alert?.copies ?? [])).toEqual([1510]);
	});

	test("an earlier identical circuit is never in an alert", async () => {
		pool = await setUp();
		const m2510 = (await walletPage(pool)).miners.find(
			(m) => m.circuit.tokenId === 2510n,
		);
		// MINE6/2683, designed earlier, is listed (the page fixture's listing 28,200)
		expect(m2510?.alert).toBeNull();
	});

	test("the wallet's own listings are left out, and a copy by the same address says so", async () => {
		pool = await setUp();
		const page = await walletPage(pool);
		const m1008 = page.miners.find((m) => m.circuit.tokenId === 1008n);
		const m1144 = page.miners.find((m) => m.circuit.tokenId === 1144n);
		// 1144 is later and identical to 1008, but the wallet lists it itself
		expect(ids(m1008?.alert?.copies ?? [])).toEqual([1147]);
		expect(m1008?.alert?.copies[0]?.sameAddress).toBe(false);
		expect(ids(m1144?.alert?.copies ?? [])).toEqual([1147]);
		expect(m1144?.alert?.copies[0]?.sameAddress).toBe(true);
	});

	test("below the size floor there is no alert, even with a later identical circuit listed", async () => {
		pool = await setUp();
		const page = await walletPage(pool);
		const m46 = page.miners.find((m) => m.circuit.tokenId === 46n);
		const m128 = page.miners.find((m) => m.circuit.tokenId === 128n);
		// MINE6/46 has one gate and no earlier copy; P0/5388 is identical, later and listed
		expect(m46?.check).toMatchObject({
			state: "checked",
			originality: { result: { verdict: "no-earlier-copy" } },
		});
		expect(m46?.alert).toBeNull();
		expect(m128?.alert).toBeNull();
	});

	test("each RIG voucher the wallet holds is its miner, held as a voucher", async () => {
		pool = await setUp();
		const vouchers = await readHeldVouchers(xlayer(), {
			holder: VOUCHER_HOLDER,
			blockNumber: BigInt(held.block),
		});
		// Made up: the two vouchers' miners in the index (their circuits are newer than the fixture's)
		for (const [i, v] of vouchers.vouchers.entries()) {
			await pool.query(
				`insert into processors (address, issued, read_at_block) values ($1, $2, 1)
				 on conflict (address) do nothing`,
				[v.circuit.processor, v.circuit.id.toString()],
			);
			await pool.query(
				`insert into circuits (processor, id, taped_out_block, taped_out_tx, taped_out_log,
				   taped_out_time, taped_out_by) values ($1, $2, $3, 0, 0, 1779000000, $4)`,
				[v.circuit.processor, v.circuit.id.toString(), 134_000_000 + i, OTHER],
			);
			await pool.query(
				`insert into miners (key, processor, id, first_started_block, last_started_block,
				   last_started_tx, last_started_log, starts) values ($1, $2, $3, $4, $4, 0, 0, 1)`,
				[
					Buffer.from(minerKey(v.circuit).slice(2), "hex"),
					v.circuit.processor,
					v.circuit.id.toString(),
					134_000_010 + i,
				],
			);
		}
		const page = await walletPage(pool, VOUCHER_HOLDER);
		expect(
			page.miners
				.map((m) => m.heldAs)
				.sort((a, b) =>
					a.kind === "voucher" && b.kind === "voucher"
						? Number(a.voucherId - b.voucherId)
						: 0,
				),
		).toEqual([
			{ kind: "voucher", voucherId: 16n },
			{ kind: "voucher", voucherId: 19n },
		]);
		expect(page.miners.map((m) => m.check.state)).toEqual([
			"not-checked",
			"not-checked",
		]);
	});

	test("a voucher whose miner the index doesn't have yet is not ready, never left out", async () => {
		pool = await setUp();
		const read = await readWalletMiners(
			{ pool, xlayer: xlayer() },
			VOUCHER_HOLDER,
		);
		expect(read).toMatchObject({
			ok: false,
			error: {
				error: "not-ready",
				detail: expect.stringMatching(/voucher #1[69]/),
			},
		});
	});

	test("before the owner follow's first run, the page is not ready", async () => {
		pool = await setUp({ ownersFollowed: false });
		const read = await readWalletMiners({ pool, xlayer: xlayer() }, WALLET);
		expect(read).toMatchObject({ ok: false, error: { error: "not-ready" } });
	});

	test("an X Layer read that fails is read-failed, never a wallet with no vouchers", async () => {
		pool = await setUp();
		const read = await readWalletMiners(
			{ pool, xlayer: replayClient({ ...held, calls: [] }) },
			WALLET,
		);
		expect(read).toMatchObject({ ok: false, error: { error: "read-failed" } });
	});
});
