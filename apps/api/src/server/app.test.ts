import { readNetworkState } from "@foreman/chain-bnb";
import { replayClient } from "@foreman/chain-bnb/fixture";
import held from "@foreman/chain-xlayer/fixtures/xlayer-held-vouchers.json" with {
	type: "json",
};
import {
	parseAddress,
	parseApiError,
	parseCheckAnswer,
	parseCircuitPage,
	parseListingsPage,
	parseWalletMiners,
	serialiseCircuitPage,
	serialiseListingsPage,
	serialiseWalletMiners,
} from "@foreman/contract";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../../fixtures/circuit-page.json" with { type: "json" };
import { readCircuitPage } from "../page/circuit-page.ts";
import { readListingsPage } from "../page/listings-page.ts";
import { PAGE_CIRCUITS, pageIndex } from "../page/page-fixture.ts";
import { readWalletMiners } from "../page/wallet-page.ts";
import { loadResultContext } from "../result.ts";
import { createApp } from "./app.ts";

// GET /circuit/:processor/:tokenId (docs/data-contract.md, "API responses") on the result page's
// fixture (fixtures/README.md): the page as wire JSON, or an ApiError with a fitting status.

const MARKET = {
	block: BigInt(fixture.market.block),
	time: BigInt(fixture.market.time),
};

async function setUp() {
	const pool = await pageIndex({
		bnb: replayClient(fixture.bnb),
		market: MARKET,
		networkDays: fixture.networkDays,
	});
	const deps = {
		pool,
		bnb: replayClient(fixture.bnb),
		xlayer: replayClient(fixture.xlayer),
		results: {
			chainId: 1952 as const,
			address: parseAddress("0xe1b2343d3da66afec740c0fcaf40a701e2d513e8", "c"),
		},
		resultContext: () => loadResultContext(pool, replayClient(circuits)),
	};
	return { pool, deps, app: createApp(deps) };
}

describe.skipIf(!TEST_DATABASE_URL)("GET /circuit/:processor/:tokenId", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("sends the circuit's page as the contract's wire JSON, which parses back to the same page", async () => {
		const set = await setUp();
		pool = set.pool;
		const { processor, id } = PAGE_CIRCUITS.mining;
		const res = await set.app.request(`/circuit/${processor}/${id}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		const body = await res.json();
		const direct = await readCircuitPage(set.deps, PAGE_CIRCUITS.mining);
		if (!direct.ok) throw new Error(direct.error.detail);
		expect(body).toEqual(serialiseCircuitPage(direct.page, "page"));
		expect(parseCircuitPage(body, "page")).toEqual(direct.page);
	});

	test("accepts a checksummed processor address", async () => {
		const set = await setUp();
		pool = set.pool;
		const res = await set.app.request(
			`/circuit/0x1F5cb4AEae1807bf60c3B9C0d8ADbcc14E91F12c/${PAGE_CIRCUITS.mining.id}`,
		);
		expect(res.status).toBe(200);
	});

	test.each([
		["a processor that isn't an address", "/circuit/0x1234/2683"],
		[
			"a token id that isn't a whole number",
			`/circuit/${PAGE_CIRCUITS.mining.processor}/12a`,
		],
	])(
		"%s is not-recognised, 400, saying what is accepted",
		async (_why, path) => {
			const set = await setUp();
			pool = set.pool;
			const res = await set.app.request(path);
			expect(res.status).toBe(400);
			expect(parseApiError(await res.json(), "error")).toMatchObject({
				error: "not-recognised",
			});
		},
	);

	test("a circuit outside the index is unknown-circuit, 404", async () => {
		const set = await setUp();
		pool = set.pool;
		const res = await set.app.request(
			`/circuit/${PAGE_CIRCUITS.mining.processor}/999999`,
		);
		expect(res.status).toBe(404);
		expect(parseApiError(await res.json(), "error").error).toBe(
			"unknown-circuit",
		);
	});

	test("GET /listings sends the listings page as wire JSON, which parses back to the same page", async () => {
		const set = await setUp();
		pool = set.pool;
		const n = await readNetworkState(replayClient(fixture.bnb), {
			blockNumber: MARKET.block,
		});
		await pool.query(
			`update index_state set market_verified_weight = $1, market_unverified_weight = $2,
			   market_miner_count = $3, market_verified_miner_count = $4`,
			[
				n.verifiedWeight,
				n.unverifiedWeight,
				n.minerCount,
				n.verifiedMinerCount,
			].map(String),
		);
		const res = await set.app.request(
			"/listings?set=all&verdict=no-earlier-copy",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		const direct = await readListingsPage(pool, {
			set: "all",
			verdict: "no-earlier-copy",
			cursor: null,
		});
		if (!direct.ok) throw new Error(direct.error.detail);
		expect(body).toEqual(serialiseListingsPage(direct.page, "page"));
		expect(parseListingsPage(body, "page")).toEqual(direct.page);
	});

	test("GET /listings before the network is stored with the market is not-ready, 503", async () => {
		const set = await setUp();
		pool = set.pool;
		const res = await set.app.request("/listings");
		expect(res.status).toBe(503);
		expect(parseApiError(await res.json(), "error").error).toBe("not-ready");
	});

	test.each([
		["a set that isn't mining or all", "/listings?set=cheap"],
		["a verdict that isn't one of the verdicts", "/listings?verdict=original"],
	])("%s is not-recognised, 400", async (_why, path) => {
		const set = await setUp();
		pool = set.pool;
		const res = await set.app.request(path);
		expect(res.status).toBe(400);
		expect(parseApiError(await res.json(), "error").error).toBe(
			"not-recognised",
		);
	});
});

describe.skipIf(!TEST_DATABASE_URL)("GET /wallet/:address/miners", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	// The held-voucher fixture's wallet with no voucher, made up to hold MINE6/967
	const WALLET = held.noVouchers;

	test("sends the wallet's page as wire JSON, which parses back to the same page", async () => {
		const set = await setUp();
		pool = set.pool;
		await pool.query(
			`insert into circuit_owners (processor, id, owner, block, tx_index, log_index)
			 values ($1, 967, $2, 130000000, 0, 0)`,
			[PAGE_CIRCUITS.mining.processor, WALLET],
		);
		await pool.query("update index_state set owners_up_to_block = 134673279");
		const deps = { ...set.deps, xlayer: replayClient(held) };
		// A checksummed address is the same wallet
		const res = await createApp(deps).request(
			`/wallet/${WALLET.toUpperCase().replace("0X", "0x")}/miners`,
		);
		expect(res.status).toBe(200);
		const page = parseWalletMiners(await res.json(), "page");
		const direct = await readWalletMiners(
			{ ...deps, xlayer: replayClient(held) },
			parseAddress(WALLET, "wallet"),
		);
		if (!direct.ok) throw new Error(direct.error.detail);
		expect(serialiseWalletMiners(page, "page")).toEqual(
			serialiseWalletMiners(direct.page, "page"),
		);
		expect(page.miners.map((m) => m.circuit.tokenId)).toEqual([967n]);
	});

	test("before the owners are followed, it is not-ready, 503", async () => {
		const set = await setUp();
		pool = set.pool;
		const res = await set.app.request(`/wallet/${WALLET}/miners`);
		expect(res.status).toBe(503);
		expect(parseApiError(await res.json(), "error").error).toBe("not-ready");
	});

	test("anything but a wallet address is unknown-wallet-input, 400", async () => {
		const set = await setUp();
		pool = set.pool;
		const res = await set.app.request("/wallet/vitalik.eth/miners");
		expect(res.status).toBe(400);
		expect(parseApiError(await res.json(), "error")).toMatchObject({
			error: "unknown-wallet-input",
			detail:
				"That isn't a wallet address: 0x followed by 40 hexadecimal characters",
		});
	});
});

describe.skipIf(!TEST_DATABASE_URL)("GET /check", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("sends the circuit an input names as the contract's wire JSON", async () => {
		const set = await setUp();
		pool = set.pool;
		const { processor, id } = PAGE_CIRCUITS.mining;
		const res = await set.app.request(
			`/check?q=${encodeURIComponent(`${processor} ${id}`)}`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(parseCheckAnswer(await res.json(), "check")).toEqual({
			processor,
			tokenId: id,
		});
	});

	test("an input it doesn't know is 400 with what the Check box accepts", async () => {
		const set = await setUp();
		pool = set.pool;
		for (const path of ["/check?q=hello", "/check"]) {
			const res = await set.app.request(path);
			expect(res.status).toBe(400);
			const error = parseApiError(await res.json(), "error");
			expect(error.error).toBe("not-recognised");
		}
	});

	test("a listing the market hasn't seen is 404 in plain words", async () => {
		const set = await setUp();
		pool = set.pool;
		const res = await set.app.request("/check?q=listing%20999999999");
		expect(res.status).toBe(404);
		expect(parseApiError(await res.json(), "error").detail).toMatch(
			/^No listing 999999999 on TapeOut/,
		);
	});
});
