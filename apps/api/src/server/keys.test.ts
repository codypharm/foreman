import { replayClient } from "@foreman/chain-bnb/fixture";
import { apiPaymentCode } from "@foreman/chain-xlayer/pro";
import {
	apiKeyMessage,
	parseAddress,
	parseApiError,
	parseApiKeyAnswer,
	parseApiKeyStatus,
} from "@foreman/contract";
import { readApiKeys, recordProPayment } from "@foreman/index";
import { TEST_DATABASE_URL } from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "../../fixtures/circuit-page.json" with { type: "json" };
import { PAGE_CIRCUITS, pageIndex } from "../page/page-fixture.ts";
import { loadResultContext } from "../result.ts";
import { createApp } from "./app.ts";

// POST /keys, a key made with a wallet signature (docs/decisions/2026-11-26-self-serve-api-keys.md).
// Each run signs with a throwaway wallet made fresh for the test: no key is kept anywhere.

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);

async function setUp() {
	let now = NOW;
	const pool = await pageIndex({
		bnb: replayClient(fixture.bnb),
		market: {
			block: BigInt(fixture.market.block),
			time: BigInt(fixture.market.time),
		},
		networkDays: fixture.networkDays,
	});
	const app = createApp(
		{
			pool,
			bnb: replayClient(fixture.bnb),
			xlayer: replayClient(fixture.xlayer),
			results: {
				chainId: 1952,
				address: parseAddress(
					"0xe1b2343d3da66afec740c0fcaf40a701e2d513e8",
					"c",
				),
			},
			resultContext: () => loadResultContext(pool, replayClient(circuits)),
		},
		{ now: () => now },
	);
	return {
		pool,
		app,
		wallet: privateKeyToAccount(generatePrivateKey()),
		setNow: (t: number) => {
			now = t;
		},
	};
}

type Wallet = ReturnType<typeof privateKeyToAccount>;

async function signed(wallet: Wallet, at: number, signer: Wallet = wallet) {
	const message = apiKeyMessage(
		parseAddress(wallet.address.toLowerCase(), "w"),
		new Date(at),
	);
	return {
		wallet: wallet.address,
		message,
		signature: await signer.signMessage({ message }),
	};
}

function post(app: ReturnType<typeof createApp>, body: unknown) {
	return app.request("/keys", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://foreman.example",
		},
		body: JSON.stringify(body),
	});
}

function results(app: ReturnType<typeof createApp>, key: string) {
	return app.request("/v1/results", {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			circuits: [
				{
					chainId: 56,
					processor: PAGE_CIRCUITS.mining.processor,
					tokenId: PAGE_CIRCUITS.mining.id.toString(),
				},
			],
		}),
	});
}

describe.skipIf(!TEST_DATABASE_URL)("POST /keys", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	test("a signed message makes a key that answers /v1/results; a new one ends the old", async () => {
		const set = await setUp();
		pool = set.pool;
		const res = await post(set.app, await signed(set.wallet, NOW - 60_000));
		expect(res.status).toBe(200);
		// The page calls it from the browser
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		const first = parseApiKeyAnswer(await res.json(), "body");
		expect(first.wallet).toBe(set.wallet.address.toLowerCase());
		expect((await results(set.app, first.key)).status).toBe(200);

		const again = await post(set.app, await signed(set.wallet, NOW));
		const second = parseApiKeyAnswer(await again.json(), "body");
		expect((await results(set.app, second.key)).status).toBe(200);
		expect((await results(set.app, first.key)).status).toBe(401);
	});

	test.each([
		["signed by another wallet", "other"],
		["more than 10 minutes old", "old"],
		["sent a second time", "again"],
	] as const)(
		"a message %s is signature-refused, 403, and makes no key",
		async (_why, kind) => {
			const set = await setUp();
			pool = set.pool;
			let body: Awaited<ReturnType<typeof signed>>;
			if (kind === "other") {
				body = await signed(
					set.wallet,
					NOW,
					privateKeyToAccount(generatePrivateKey()),
				);
			} else if (kind === "old") {
				body = await signed(set.wallet, NOW - 601_000);
			} else {
				body = await signed(set.wallet, NOW);
				expect((await post(set.app, body)).status).toBe(200);
			}
			const keysBefore = (await readApiKeys(pool)).length;
			const res = await post(set.app, body);
			expect(res.status).toBe(403);
			expect(parseApiError(await res.json(), "error").error).toBe(
				"signature-refused",
			);
			expect((await readApiKeys(pool)).length).toBe(keysBefore);
		},
	);

	test("GET /keys/:wallet says when the wallet's live key was made, never the key", async () => {
		const set = await setUp();
		pool = set.pool;
		const status = async (wallet: string) => {
			const res = await set.app.request(`/keys/${wallet}`, {
				headers: { origin: "https://foreman.example" },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
			const body = await res.json();
			expect(JSON.stringify(body)).not.toContain("fmn_");
			return parseApiKeyStatus(body, "body");
		};
		const none = await status(set.wallet.address);
		expect([none.madeAt, none.keyEnding]).toEqual([null, null]);

		const made = await post(set.app, await signed(set.wallet, NOW));
		expect(made.status).toBe(200);
		const { key } = parseApiKeyAnswer(await made.json(), "body");
		const after = await status(set.wallet.address);
		expect(after.wallet).toBe(set.wallet.address.toLowerCase());
		expect(after.madeAt).not.toBeNull();
		// The key's last 4 characters, so the page can say which key it is (2026-11-27-key-ending.md)
		expect(after.keyEnding).toBe(key.slice(-4));

		// The paid API tier's end (2026-11-26-paid-api-tier.md, decision 7): null until the wallet pays,
		// then 30 days from the payment, and null again once that has passed
		expect(after.paidUntil).toBeNull();
		const DAY = 86_400_000;
		await recordProPayment(set.pool, {
			txHash: `0x${"5".repeat(64)}`,
			logIndex: 0,
			block: 47_300_000n,
			paidAt: new Date(NOW - DAY),
			code: apiPaymentCode(set.wallet.address),
			payer: set.wallet.address,
			amount: 10_000_000_000_000_000n,
		});
		expect((await status(set.wallet.address)).paidUntil).toBe(
			BigInt((NOW + 29 * DAY) / 1000),
		);
		set.setNow(NOW + 30 * DAY);
		expect((await status(set.wallet.address)).paidUntil).toBeNull();

		const bad = await set.app.request("/keys/0x123");
		expect(bad.status).toBe(400);
		expect(parseApiError(await bad.json(), "error").error).toBe(
			"not-recognised",
		);
	});

	test("a changed message is not-recognised, 400, and makes no key", async () => {
		const set = await setUp();
		pool = set.pool;
		const body = await signed(set.wallet, NOW);
		const res = await post(set.app, {
			...body,
			message: body.message.replace("Foreman", "F0reman"),
		});
		expect(res.status).toBe(400);
		expect(parseApiError(await res.json(), "error").error).toBe(
			"not-recognised",
		);
		expect(await readApiKeys(pool)).toEqual([]);
	});
});
