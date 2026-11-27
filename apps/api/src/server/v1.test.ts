import { replayClient } from "@foreman/chain-bnb/fixture";
import { apiPaymentCode } from "@foreman/chain-xlayer/pro";
import {
	parseAddress,
	parseApiError,
	parseBulkResults,
	parseHex32,
} from "@foreman/contract";
import {
	createApiKey,
	createWalletApiKey,
	readApiKeys,
	readStoredResult,
	recordProPayment,
	recordPublished,
	revokeApiKey,
} from "@foreman/index";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../../fixtures/circuit-page.json" with { type: "json" };
import { PAGE_CIRCUITS, pageIndex } from "../page/page-fixture.ts";
import { planEntry } from "../publish/plan.ts";
import { loadResultContext } from "../result.ts";
import { createApp } from "./app.ts";

// POST /v1/results, the keyed bulk results call (docs/decisions/2026-11-26-api-keys.md), on the
// result page's fixture: a stored miner, a circuit built on request, and one outside the index.

const TESTNET = {
	chainId: 1952 as const,
	address: parseAddress("0xe1b2343d3da66afec740c0fcaf40a701e2d513e8", "c"),
};

async function setUp(now: () => number = Date.now) {
	const pool = await pageIndex({
		bnb: replayClient(fixture.bnb),
		market: {
			block: BigInt(fixture.market.block),
			time: BigInt(fixture.market.time),
		},
		networkDays: fixture.networkDays,
	});
	const deps = {
		pool,
		bnb: replayClient(fixture.bnb),
		xlayer: replayClient(fixture.xlayer),
		results: TESTNET,
		resultContext: () => loadResultContext(pool, replayClient(circuits)),
	};
	const { key, id } = await createApiKey(pool, "OwlGate");
	return { pool, key, id, app: createApp(deps, { now }) };
}

const wire = (c: { processor: string; id: bigint }) => ({
	chainId: 56,
	processor: c.processor,
	tokenId: c.id.toString(),
});

function post(
	app: ReturnType<typeof createApp>,
	key: string | null,
	body: unknown,
) {
	return app.request("/v1/results", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(key ? { authorization: `Bearer ${key}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

describe.skipIf(!TEST_DATABASE_URL)("POST /v1/results", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("answers each circuit in the order asked: stored with where it was published, built on request, or can't check with its reason", async () => {
		const set = await setUp();
		pool = set.pool;
		const stored = await readStoredResult(pool, PAGE_CIRCUITS.mining);
		if (!stored) throw new Error("no stored result");
		const at = {
			tx: parseHex32(`0x${"52".repeat(32)}`, "tx"),
			block: 46_803_541n,
		};
		await recordPublished(pool, TESTNET, [planEntry(stored.originality)], at);

		const res = await post(set.app, set.key, {
			circuits: [
				wire(PAGE_CIRCUITS.pasted),
				wire(PAGE_CIRCUITS.mining),
				wire({ processor: PAGE_CIRCUITS.mining.processor, id: 999_999n }),
				{ ...wire(PAGE_CIRCUITS.mining), chainId: 196 },
			],
		});
		expect(res.status).toBe(200);
		// Server to server only: no browser may call it with a key
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
		const { results } = parseBulkResults(await res.json(), "body");
		expect(results.map((r) => r.circuit.tokenId)).toEqual([
			6534n,
			2683n,
			999_999n,
			2683n,
		]);

		const [pasted, mining, outside, wrongChain] = results;
		expect(
			pasted?.check.state === "checked" && pasted.check.originality.scope,
		).toBe("pasted");
		expect(pasted?.published).toEqual({
			state: "not-published",
			reason: "pasted",
		});

		expect(mining?.check).toEqual({
			state: "checked",
			originality: stored.originality,
		});
		expect(mining?.published).toMatchObject({
			state: "current",
			publishedAt: { chainId: 1952, ...at },
		});

		// Never a verdict for a circuit Foreman can't check
		expect(outside?.check).toEqual({
			state: "not-checked",
			detail: `Circuit #999999 on processor ${PAGE_CIRCUITS.mining.processor} isn't in Foreman's index`,
		});
		expect(wrongChain?.check).toEqual({
			state: "not-checked",
			detail: `Circuit #2683 on processor ${PAGE_CIRCUITS.mining.processor} is on chain 56, not 196`,
		});

		// The call is counted for the key's day: one call, four circuits
		const [owl] = await readApiKeys(pool);
		expect(owl?.days.map((d) => [d.calls, d.circuits])).toEqual([[1, 4]]);
	});

	test("a miner with no stored result yet is can't check, as on its result page: never built as pasted", async () => {
		const set = await setUp();
		pool = set.pool;
		await pool.query(
			"delete from circuit_results where processor = $1 and id = $2",
			[PAGE_CIRCUITS.cooling.processor, PAGE_CIRCUITS.cooling.id.toString()],
		);
		const res = await post(set.app, set.key, {
			circuits: [wire(PAGE_CIRCUITS.cooling), wire(PAGE_CIRCUITS.pasted)],
		});
		expect(res.status).toBe(200);
		const { results } = parseBulkResults(await res.json(), "body");
		expect(results[0]?.check).toEqual({
			state: "not-checked",
			detail: "Foreman hasn't checked this miner yet",
		});
		expect(results[0]?.published).toEqual({
			state: "not-published",
			reason: "not-yet",
		});
		expect(results[1]?.check.state).toBe("checked");
	});

	test("a missing, unknown or revoked key is no-key, 401, and isn't counted", async () => {
		const set = await setUp();
		pool = set.pool;
		const body = { circuits: [wire(PAGE_CIRCUITS.mining)] };
		for (const key of [null, "fmn_notakey", "nonsense"]) {
			const res = await post(set.app, key, body);
			expect(res.status).toBe(401);
			expect(parseApiError(await res.json(), "error").error).toBe("no-key");
		}
		await revokeApiKey(pool, set.id);
		expect((await post(set.app, set.key, body)).status).toBe(401);
		const [owl] = await readApiKeys(pool);
		expect(owl?.days).toEqual([]);
	});

	test("a body that isn't 1 to 100 circuits is not-recognised, 400, saying what is accepted", async () => {
		const set = await setUp();
		pool = set.pool;
		for (const body of [{ circuits: [] }, { circuit: 1 }, "not json"]) {
			const res = await post(set.app, set.key, body);
			expect(res.status).toBe(400);
			const error = parseApiError(await res.json(), "error");
			expect(error.error).toBe("not-recognised");
		}
	});

	test("the 61st call in a minute is too-many-calls, 429, with when to try again", async () => {
		let now = Date.UTC(2026, 10, 27, 12, 0, 10);
		const set = await setUp(() => now);
		pool = set.pool;
		const body = {
			circuits: [
				wire({ processor: PAGE_CIRCUITS.mining.processor, id: 999_999n }),
			],
		};
		for (let i = 0; i < 60; i++) {
			expect((await post(set.app, set.key, body)).status).toBe(200);
		}
		const refused = await post(set.app, set.key, body);
		expect(refused.status).toBe(429);
		expect(refused.headers.get("retry-after")).toBe("50");
		expect(parseApiError(await refused.json(), "error").error).toBe(
			"too-many-calls",
		);
		// A minute after the first call, calls are taken again
		now += 50_000;
		expect((await post(set.app, set.key, body)).status).toBe(200);
		const [owl] = await readApiKeys(pool);
		expect(owl?.days.map((d) => d.calls)).toEqual([61]);
	});

	// The paid API tier (docs/decisions/2026-11-26-paid-api-tier.md, decisions 1, 2 and 5)
	const WALLET = "0x077ea6b4c1dfc7f7ec253d736c56898dfc192ea5";
	const DAY = 86_400_000;
	async function walletKeyPaid(
		set: Awaited<ReturnType<typeof setUp>>,
		paidAt: number,
	) {
		const made = await createWalletApiKey(set.pool, WALLET, new Date(paidAt));
		if (!made.made) throw new Error("no key");
		await recordProPayment(set.pool, {
			txHash: `0x${"7".repeat(64)}`,
			logIndex: 0,
			block: 47_300_000n,
			paidAt: new Date(paidAt),
			code: apiPaymentCode(WALLET),
			payer: WALLET,
			amount: 10_000_000_000_000_000n,
		});
		return made.key;
	}
	const body = {
		circuits: [
			wire({ processor: PAGE_CIRCUITS.mining.processor, id: 999_999n }),
		],
	};

	test("a key whose wallet paid is past 60 calls a minute", async () => {
		const now = Date.UTC(2026, 10, 27, 12, 0, 10);
		const set = await setUp(() => now);
		pool = set.pool;
		const key = await walletKeyPaid(set, now - DAY);
		for (let i = 0; i < 61; i++) {
			expect((await post(set.app, key, body)).status).toBe(200);
		}
	});

	test("once the wallet's paid time ends, its key is back to 60 and the 429 says so", async () => {
		const now = Date.UTC(2026, 10, 27, 12, 0, 10);
		const set = await setUp(() => now);
		pool = set.pool;
		const key = await walletKeyPaid(set, now - 40 * DAY); // ended 10 days ago
		for (let i = 0; i < 60; i++) {
			expect((await post(set.app, key, body)).status).toBe(200);
		}
		const refused = await post(set.app, key, body);
		expect(refused.status).toBe(429);
		expect(parseApiError(await refused.json(), "error").detail).toBe(
			"At most 60 calls a minute: this wallet's 600 a minute ended on 17 Nov 2026. Pay again on Foreman's API page; try again in 50 s",
		);
	});
});
