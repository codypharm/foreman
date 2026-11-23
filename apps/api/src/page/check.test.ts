import { replayClient } from "@foreman/chain-bnb/fixture";
import voucherFixture from "@foreman/chain-xlayer/fixtures/xlayer-voucher-circuit.json" with {
	type: "json",
};
import { emptyIndexAt, TEST_DATABASE_URL } from "@foreman/index/testing";
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import { readCheckInput, resolveCheck } from "./check.ts";

// The Check box (docs/decisions/2026-11-22-check-box-input.md): a bare number is a listing number;
// a voucher, a miner key and a circuit each have their own form. Whatever isn't found says so in
// plain words; nothing is guessed.

const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const KEY = `0x${"72".repeat(32)}`;

describe("reading what was typed into the Check box", () => {
	test.each([
		["28074", { kind: "listing", id: 28074n }],
		[" #28074 ", { kind: "listing", id: 28074n }],
		["Listing 28074", { kind: "listing", id: 28074n }],
		["listing #28074", { kind: "listing", id: 28074n }],
		["RIG voucher #19", { kind: "voucher", id: 19n }],
		["rig 19", { kind: "voucher", id: 19n }],
		["Voucher19", { kind: "voucher", id: 19n }],
		[KEY.toUpperCase().replace("0X", "0x"), { kind: "miner", key: KEY }],
		[`${PROCESSOR} 2421`, { kind: "circuit", processor: PROCESSOR, id: 2421n }],
		[`${PROCESSOR}/2421`, { kind: "circuit", processor: PROCESSOR, id: 2421n }],
		[
			`${PROCESSOR.toUpperCase().replace("0X", "0x")} #2421`,
			{ kind: "circuit", processor: PROCESSOR, id: 2421n },
		],
	])("%j", (q, expected) => {
		expect(readCheckInput(q)).toEqual(expected);
	});

	test.each([
		[""],
		["hello"],
		["0"],
		["listing 0"],
		["-5"],
		["2.5"],
		[PROCESSOR],
		[`0x${"72".repeat(31)}`],
		["https://tapeout.example/listing/28074"],
	])("%j is not recognised", (q) => {
		expect(readCheckInput(q)).toBeNull();
	});
});

describe.skipIf(!TEST_DATABASE_URL)(
	"finding the circuit an input names",
	() => {
		let pool: pg.Pool | undefined;
		afterEach(async () => {
			await pool?.end();
		});
		const BLOCK = 134_895_911n;

		async function indexed() {
			const p = await emptyIndexAt(BLOCK);
			await p.query(
				"update index_state set market_up_to_block = $1, market_up_to_time = 1795268036, miners_up_to_block = $1",
				[BLOCK.toString()],
			);
			await p.query(
				`insert into market_listings (listing_id, read_at_block, open, seller, processor, token_id,
			   price_wei, fee_bps, listed_block, listed_time, state_read_at_block, buyable, miner_status,
			   miner_task_id, miner_verif_weight, miner_unver_weight, miner_weight_without_bonus)
			 values (28074, $1, true, $2, $3, 2421, 53800000000000000000, 100, 134850000, 1795050000, $1, true, 1, 150, 1578, 0, 330)`,
				[BLOCK.toString(), `0x${"fd".repeat(20)}`, PROCESSOR],
			);
			await p.query(
				"insert into market_listings (listing_id, read_at_block, open) values (26000, $1, false)",
				[BLOCK.toString()],
			);
			await p.query(
				`insert into miners (key, processor, id, first_started_block, last_started_block,
			   last_started_tx, last_started_log, starts)
			 values (decode($1, 'hex'), $2, 2421, 122175300, 122175300, 1, 1, 1)`,
				[KEY.slice(2), PROCESSOR],
			);
			return p;
		}
		const deps = (p: pg.Pool, xlayer = replayClient(voucherFixture)) => ({
			pool: p,
			xlayer,
		});

		test("a listing number opens its circuit", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), "28074")).toEqual({
				ok: true,
				answer: { processor: PROCESSOR, tokenId: 2421n },
			});
		});

		test("a withdrawn listing says so and asks for the circuit instead", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), "listing 26000")).toEqual({
				ok: false,
				error: {
					error: "unknown-circuit",
					detail:
						"Listing 26000 was withdrawn, so Foreman doesn’t know its circuit. Paste the circuit or its miner key instead.",
				},
			});
		});

		test("a listing the market hasn't seen is no such listing, up to the market's block", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), "99999")).toEqual({
				ok: false,
				error: {
					error: "unknown-circuit",
					detail:
						"No listing 99999 on TapeOut’s circuit market up to BNB block 134,895,911",
				},
			});
		});

		test("a miner key opens its circuit; an unknown key is not in the index", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), KEY)).toEqual({
				ok: true,
				answer: { processor: PROCESSOR, tokenId: 2421n },
			});
			expect(await resolveCheck(deps(pool), `0x${"99".repeat(32)}`)).toEqual({
				ok: false,
				error: {
					error: "unknown-circuit",
					detail:
						"No miner with that key in the index up to BNB block 134,895,911",
				},
			});
		});

		test("a live RIG voucher opens its miner's circuit, read on X Layer", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), "RIG voucher #19")).toEqual({
				ok: true,
				answer: {
					processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
					tokenId: 12814n,
				},
			});
		});

		test("a redeemed or never-minted voucher says both, without guessing which", async () => {
			pool = await indexed();
			for (const id of [3, 999]) {
				expect(await resolveCheck(deps(pool), `voucher ${id}`)).toEqual({
					ok: false,
					error: {
						error: "unknown-circuit",
						detail: `No live RIG voucher #${id} on X Layer: it was never minted or has been redeemed.`,
					},
				});
			}
		});

		test("a circuit is passed through as itself", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), `${PROCESSOR}/2421`)).toEqual({
				ok: true,
				answer: { processor: PROCESSOR, tokenId: 2421n },
			});
		});

		test("anything else is not recognised, with what the Check box accepts", async () => {
			pool = await indexed();
			const read = await resolveCheck(deps(pool), "hello");
			expect(read.ok).toBe(false);
			if (read.ok) return;
			expect(read.error.error).toBe("not-recognised");
			expect("accepted" in read.error && read.error.accepted.length).toBe(4);
		});

		test("X Layer failing is a failed read, never 'no such voucher'", async () => {
			pool = await indexed();
			const read = await resolveCheck(
				deps(pool, replayClient({ ...voucherFixture, calls: [] })),
				"RIG 19",
			);
			expect(read).toMatchObject({
				ok: false,
				error: { error: "read-failed" },
			});
		});

		test("before the market's first fill a listing is not ready, never 'no such listing'", async () => {
			pool = await emptyIndexAt(BLOCK);
			const read = await resolveCheck(deps(pool), "28074");
			expect(read).toMatchObject({ ok: false, error: { error: "not-ready" } });
		});
	},
);
