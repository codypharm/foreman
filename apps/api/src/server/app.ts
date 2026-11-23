// The public, read-only API (docs/decisions/2026-11-21-api-endpoints.md; shapes in
// docs/data-contract.md, "API responses"). Every body is the contract's wire JSON, made by its own
// serialiser, so the API never sends what the app would refuse. Any site may read it.

import {
	type ApiError,
	LISTING_VERDICTS,
	type ListingVerdict,
	serialiseApiError,
	serialiseCheckAnswer,
	serialiseCircuitPage,
	serialiseListingsPage,
	serialiseWalletMiners,
} from "@foreman/contract";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { resolveCheck } from "../page/check.ts";
import { type PageDeps, readCircuitPage } from "../page/circuit-page.ts";
import { readListingsPage } from "../page/listings-page.ts";
import { readWalletMiners } from "../page/wallet-page.ts";

const STATUS: Record<ApiError["error"], ContentfulStatusCode> = {
	"not-recognised": 400,
	"unknown-wallet-input": 400,
	"unknown-circuit": 404,
	"read-failed": 502,
	"not-ready": 503,
};

const CIRCUIT_ACCEPTS = [
	"a processor address: 0x followed by 40 hexadecimal characters",
	"a token id: a whole number",
];

const LISTINGS_ACCEPTS = [
	"set: mining (the default) or all",
	`verdict: one of ${LISTING_VERDICTS.join(", ")}, or none`,
	"cursor: the next value of the page before, or none",
];

export function createApp(deps: PageDeps): Hono {
	const app = new Hono();
	app.use("*", cors({ origin: "*", allowMethods: ["GET"] }));

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
