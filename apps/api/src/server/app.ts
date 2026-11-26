// The public, read-only API (docs/decisions/2026-11-21-api-endpoints.md; shapes in
// docs/data-contract.md, "API responses"). Every body is the contract's wire JSON, made by its own
// serialiser, so the API never sends what the app would refuse. Any site may read it.

import {
	API_KEY_MESSAGE_MAX_AGE_SECONDS,
	type ApiError,
	LISTING_VERDICTS,
	type ListingVerdict,
	parseAddress,
	parseApiKeyRequest,
	parseBulkRequest,
	serialiseApiError,
	serialiseApiKeyAnswer,
	serialiseApiKeyStatus,
	serialiseBulkResults,
	serialiseCheckAnswer,
	serialiseCircuitPage,
	serialiseListingsPage,
	serialiseWalletMiners,
} from "@foreman/contract";
import {
	createWalletApiKey,
	findApiKey,
	readWalletApiKey,
	recordApiUsage,
} from "@foreman/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { verifyMessage } from "viem";
import { resolveCheck } from "../page/check.ts";
import { type PageDeps, readCircuitPage } from "../page/circuit-page.ts";
import { readListingsPage } from "../page/listings-page.ts";
import { readWalletMiners } from "../page/wallet-page.ts";
import { rateLimiter } from "../v1/rate-limit.ts";
import { readBulkResults } from "../v1/results.ts";
import { readHealth } from "./health.ts";

const STATUS: Record<ApiError["error"], ContentfulStatusCode> = {
	"not-recognised": 400,
	"unknown-wallet-input": 400,
	"unknown-circuit": 404,
	"read-failed": 502,
	"not-ready": 503,
	"no-key": 401,
	"too-many-calls": 429,
	"signature-refused": 403,
};

const CIRCUIT_ACCEPTS = [
	"a processor address: 0x followed by 40 hexadecimal characters",
	"a token id: a whole number",
];

const BULK_ACCEPTS = [
	'a JSON body {"circuits": [...]} of 1 to 100 circuits',
	'each circuit {"chainId": 56 or 196, "processor": "0x…", "tokenId": "1234"}',
];

const KEY_ACCEPTS = [
	'a JSON body {"wallet": "0x…", "message": "…", "signature": "0x…"}',
	"the message exactly as the API page makes it, signed by that wallet",
];

const LISTINGS_ACCEPTS = [
	"set: mining (the default) or all",
	`verdict: one of ${LISTING_VERDICTS.join(", ")}, or none`,
	"cursor: the next value of the page before, or none",
];

export function createApp(
	deps: PageDeps,
	options: { now?: () => number } = {},
): Hono {
	const now = options.now ?? Date.now;
	const admit = rateLimiter(now);
	const app = new Hono();
	// Any site may read the open routes. /v1 is server to server only: no CORS, so a key used from a
	// web page, where it would leak, is refused by the browser (2026-11-26-api-keys.md, decision 7)
	const open = cors({ origin: "*", allowMethods: ["GET"] });
	// The API page makes a key from the browser
	const keys = cors({
		origin: "*",
		allowMethods: ["POST"],
		allowHeaders: ["content-type"],
	});
	app.use("*", (c, next) =>
		c.req.path.startsWith("/v1/")
			? next()
			: c.req.path === "/keys"
				? keys(c, next)
				: open(c, next),
	);

	// Whether a wallet has a live key, and when it was made, so the API page can say so (data contract,
	// ApiKeyStatus). Never the key: only its hash is stored
	app.get("/keys/:wallet", async (c) => {
		let wallet: ReturnType<typeof parseAddress>;
		try {
			wallet = parseAddress(c.req.param("wallet").toLowerCase(), "wallet");
		} catch {
			return sendError(c, {
				error: "not-recognised",
				detail: "That isn't a wallet address",
				accepted: [
					"a wallet address: 0x followed by 40 hexadecimal characters",
				],
			});
		}
		const live = await readWalletApiKey(deps.pool, wallet);
		return c.json(
			serialiseApiKeyStatus(
				{
					wallet,
					madeAt: live
						? BigInt(Math.floor(live.madeAt.getTime() / 1000))
						: null,
				},
				"body",
			),
		);
	});

	// A key made with a wallet signature (2026-11-26-self-serve-api-keys.md). The key is in the answer
	// once and never logged; only its hash is stored
	app.post("/keys", async (c) => {
		let request: ReturnType<typeof parseApiKeyRequest>;
		try {
			request = parseApiKeyRequest(await c.req.json(), "body");
		} catch (error) {
			return sendError(c, {
				error: "not-recognised",
				detail: error instanceof Error ? error.message : "That body isn't JSON",
				accepted: KEY_ACCEPTS,
			});
		}
		const age = (now() - request.signedAt.getTime()) / 1000;
		if (age > API_KEY_MESSAGE_MAX_AGE_SECONDS || age < -60) {
			return sendError(c, {
				error: "signature-refused",
				detail:
					"The signed message is more than 10 minutes old, or from the future; sign again",
			});
		}
		const valid = await verifyMessage({
			address: request.wallet,
			message: request.message,
			signature: request.signature,
		}).catch(() => false);
		if (!valid) {
			return sendError(c, {
				error: "signature-refused",
				detail: `The signature isn't from ${request.wallet}`,
			});
		}
		const made = await createWalletApiKey(
			deps.pool,
			request.wallet,
			request.signedAt,
		);
		if (!made.made) {
			return sendError(c, {
				error: "signature-refused",
				detail: "That signed message was already used; sign again",
			});
		}
		return c.json(
			serialiseApiKeyAnswer({ wallet: request.wallet, key: made.key }, "body"),
		);
	});

	// The keyed bulk results call (2026-11-26-api-keys.md). The key is never logged or echoed
	app.post("/v1/results", async (c) => {
		const auth = c.req.header("authorization") ?? "";
		const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
		const holder = key ? await findApiKey(deps.pool, key) : null;
		if (!holder) {
			return sendError(c, {
				error: "no-key",
				detail:
					"Send an API key as 'Authorization: Bearer fmn_…'. Ask Foreman for a key",
			});
		}
		const admitted = admit(holder.id);
		if (!admitted.ok) {
			c.header("Retry-After", String(admitted.retryAfterSeconds));
			return sendError(c, {
				error: "too-many-calls",
				detail: `At most 60 calls a minute per key; try again in ${admitted.retryAfterSeconds} s`,
			});
		}
		let request: ReturnType<typeof parseBulkRequest>;
		try {
			request = parseBulkRequest(await c.req.json(), "body");
		} catch (error) {
			return sendError(c, {
				error: "not-recognised",
				detail: error instanceof Error ? error.message : "That body isn't JSON",
				accepted: BULK_ACCEPTS,
			});
		}
		const results = await readBulkResults(deps, request);
		const day = new Date(now()).toISOString().slice(0, 10);
		await recordApiUsage(deps.pool, holder.id, request.circuits.length, day);
		return c.json(serialiseBulkResults(results, "body"));
	});

	// Whether the hosted worker is keeping up (2026-11-23-hosting.md, decision 7)
	app.get("/health", async (c) => {
		const health = await readHealth(
			deps.pool,
			BigInt(Math.floor(Date.now() / 1000)),
		);
		return c.json(health.body, health.status);
	});

	// The Check box: what was typed, to the one circuit it names (2026-11-22-check-box-input.md)
	app.get("/check", async (c) => {
		const read = await resolveCheck(deps, c.req.query("q") ?? "");
		return read.ok
			? c.json(serialiseCheckAnswer(read.answer, "check"))
			: sendError(c, read.error);
	});

	app.get("/circuit/:processor/:tokenId", async (c) => {
		const processor = c.req.param("processor");
		const tokenId = c.req.param("tokenId");
		if (!/^0x[0-9a-fA-F]{40}$/.test(processor) || !/^\d{1,78}$/.test(tokenId)) {
			return sendError(c, {
				error: "not-recognised",
				detail: "That isn't a processor address and a token id",
				accepted: CIRCUIT_ACCEPTS,
			});
		}
		const read = await readCircuitPage(deps, {
			processor: processor.toLowerCase() as `0x${string}`,
			id: BigInt(tokenId),
		});
		return read.ok
			? c.json(serialiseCircuitPage(read.page, "page"))
			: sendError(c, read.error);
	});

	app.get("/listings", async (c) => {
		const set = c.req.query("set") ?? "mining";
		const verdict = c.req.query("verdict") ?? null;
		if (
			(set !== "mining" && set !== "all") ||
			(verdict !== null &&
				!(LISTING_VERDICTS as readonly string[]).includes(verdict))
		) {
			return sendError(c, {
				error: "not-recognised",
				detail: "That isn't a listings set and verdict this API knows",
				accepted: LISTINGS_ACCEPTS,
			});
		}
		const read = await readListingsPage(deps.pool, {
			set,
			verdict: verdict as ListingVerdict | null,
			cursor: c.req.query("cursor") ?? null,
		});
		return read.ok
			? c.json(serialiseListingsPage(read.page, "page"))
			: sendError(c, read.error);
	});

	app.get("/wallet/:address/miners", async (c) => {
		const address = c.req.param("address");
		if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
			return sendError(c, {
				error: "unknown-wallet-input",
				detail:
					"That isn't a wallet address: 0x followed by 40 hexadecimal characters",
			});
		}
		const read = await readWalletMiners(
			deps,
			address.toLowerCase() as Parameters<typeof readWalletMiners>[1],
		);
		return read.ok
			? c.json(serialiseWalletMiners(read.page, "page"))
			: sendError(c, read.error);
	});

	return app;
}

function sendError(
	c: { json: (body: unknown, status: ContentfulStatusCode) => Response },
	error: ApiError,
): Response {
	return c.json(serialiseApiError(error, "error"), STATUS[error.error]);
}
