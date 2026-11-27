import { replayClient } from "@foreman/chain-bnb/fixture";
import processorAtFixture from "@foreman/chain-bnb/fixtures/bnb-processor-at.json" with {
	type: "json",
};
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
/** FabX's processor on X Layer (CLAUDE.md "On-chain facts"). */
const FABX = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6";
const FABX_KEY = `0x${"66".repeat(32)}`;

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
		// FabX's circuits by their id (2026-11-25-fabx-copy-check.md, decision 8)
		["FabX 1234", { kind: "circuit", processor: FABX, id: 1234n }],
		["fabx #1234", { kind: "circuit", processor: FABX, id: 1234n }],
		[" FABX#1234 ", { kind: "circuit", processor: FABX, id: 1234n }],
		// A circuit as TapeOut's market labels it: its id, then its processor's place in TapeOut's
		// BNB Chain factory (2026-11-27-tapeout-circuit-label.md)
		["13931.30", { kind: "label", id: 13931n, position: 30n }],
		[" 2.5 ", { kind: "label", id: 2n, position: 5n }],
		["12.0", { kind: "label", id: 12n, position: 0n }],
	])("%j", (q, expected) => {
		expect(readCheckInput(q)).toEqual(expected);
	});

	test.each([
		[""],
		["hello"],
		["0"],
		["listing 0"],
		["-5"],
		["0.30"],
		["13931.030"],
		["13931."],
		[".30"],
		["13931.30.1"],
		[PROCESSOR],
		[`0x${"72".repeat(31)}`],
		["https://tapeout.example/listing/28074"],
		["FabX"],
		["FabX 0"],
		["FabX listing 1234"],
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
		const deps = (
			p: pg.Pool,
			xlayer = replayClient(voucherFixture),
			bnb = replayClient(processorAtFixture),
		) => ({ pool: p, xlayer, bnb });

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

		/** FabX followed to X Layer block 76,900,680, with one miner, FabX #66. */
		async function withFabx(p: pg.Pool) {
			await p.query(
				`insert into xlayer_state (logs_up_to_block, miners_read_at_block, reviewed_implementation, reviewed_at_block)
				 values (76900680, 76900680, $1, 76847895)`,
				[`0x${"90".repeat(20)}`],
			);
			await p.query(
				`insert into fabx_miners (processor, id, key, status, registrant, task_id, commit_block,
				   first_unused_id, read_at_block, commitment_status)
				 values ($1, 66, decode($2, 'hex'), 1, $3, 48, 0, 0, 76900680, 'none')`,
				[FABX, FABX_KEY.slice(2), `0x${"fb".repeat(20)}`],
			);
			return p;
		}

		test("a FabX miner key opens its FabX circuit; an unknown key is in neither chain's miners", async () => {
			// 2026-11-25-fabx-copy-check.md, decision 8: a miner key works as it is
			pool = await withFabx(await indexed());
			expect(await resolveCheck(deps(pool), FABX_KEY)).toEqual({
				ok: true,
				answer: { processor: FABX, tokenId: 66n },
			});
			expect(await resolveCheck(deps(pool), KEY)).toEqual({
				ok: true,
				answer: { processor: PROCESSOR, tokenId: 2421n },
			});
			expect(await resolveCheck(deps(pool), `0x${"99".repeat(32)}`)).toEqual({
				ok: false,
				error: {
					error: "unknown-circuit",
					detail:
						"No miner with that key in the index up to BNB block 134,895,911 or among FabX’s miners up to X Layer block 76,900,680",
				},
			});
		});

		test("a key stored as a miner on both chains opens neither circuit", async () => {
			pool = await withFabx(await indexed());
			await pool.query("update fabx_miners set key = decode($1, 'hex')", [
				KEY.slice(2),
			]);
			expect(await resolveCheck(deps(pool), KEY)).toEqual({
				ok: false,
				error: {
					error: "read-failed",
					detail:
						"Foreman’s index holds that miner key on both BNB Chain and X Layer, which shouldn’t happen. Paste the circuit instead.",
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

		test("TapeOut's label opens the circuit on the processor at that place in the factory", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), "13931.30")).toEqual({
				ok: true,
				answer: {
					processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
					tokenId: 13931n,
				},
			});
		});

		test("a label whose processor place the factory hasn't reached says so, with its count and block", async () => {
			pool = await indexed();
			expect(await resolveCheck(deps(pool), "5.1000000")).toEqual({
				ok: false,
				error: {
					error: "unknown-circuit",
					detail:
						"No processor #1000000 in TapeOut’s BNB Chain factory, which had 1,499 at BNB block 136,041,885",
				},
			});
		});

		test("BNB Chain failing on a label is a failed read, never 'no such processor'", async () => {
			pool = await indexed();
			const read = await resolveCheck(
				deps(
					pool,
					replayClient(voucherFixture),
					replayClient({ ...processorAtFixture, calls: [] }),
				),
				"13931.30",
			);
			expect(read).toMatchObject({
				ok: false,
				error: { error: "read-failed" },
			});
		});

		test("anything else is not recognised, with what the Check box accepts", async () => {
			pool = await indexed();
			const read = await resolveCheck(deps(pool), "hello");
			expect(read.ok).toBe(false);
			if (read.ok) return;
			expect(read.error.error).toBe("not-recognised");
			expect("accepted" in read.error && read.error.accepted.length).toBe(6);
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
