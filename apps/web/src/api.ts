// The Foreman API, read through the data contract's own parsers: the app never renders a response the
// contract would refuse. Errors come back as the contract's ApiError, never a crash or a silent empty.

import {
	type ApiError,
	type CheckAnswer,
	type CircuitPage,
	type ListingsPage,
	type ListingVerdict,
	parseApiError,
	parseCheckAnswer,
	parseCircuitPage,
	parseListingsPage,
	parseWalletMiners,
	type WalletMiners,
} from "@foreman/contract";

const API_URL = (
	import.meta.env.VITE_API_URL ?? "http://localhost:8787"
).replace(/\/$/, "");

/** An API answer that isn't a page: its ApiError, with words to show on screen. */
export class ApiProblem extends Error {
	readonly problem: ApiError;
	constructor(problem: ApiError) {
		super(problem.detail);
		this.problem = problem;
	}
}

/**
 * A 200 answer this tab's copy of the data contract refuses. The API checks every answer against the
 * contract before sending it, so this almost always means Foreman was updated after the page was
 * opened: links change only the part after "#", so the old code stays loaded. A reload fetches the
 * new code; "Try again" would fail the same way.
 */
export class AppOutdated extends Error {
	constructor() {
		super(
			"Foreman was updated since you opened this page, so this page can’t read its answer. Reload to get the new version.",
		);
	}
}

async function get<T>(
	path: string,
	parse: (wire: unknown, field: string) => T,
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${API_URL}${path}`);
	} catch {
		throw new ApiProblem({
			error: "read-failed",
			detail: "Couldn't reach Foreman. Check your connection and try again.",
		});
	}
	const body: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		let problem: ApiError;
		try {
			problem = parseApiError(body, "error");
		} catch {
			problem = {
				error: "read-failed",
				detail: `Foreman answered with an error (${res.status}).`,
			};
		}
		throw new ApiProblem(problem);
	}
	try {
		return parse(body, "page");
	} catch {
		throw new AppOutdated();
	}
}

export function fetchListings(query: {
	set: ListingsPage["set"];
	verdict: ListingVerdict | null;
	cursor: string | null;
}): Promise<ListingsPage> {
	const params = new URLSearchParams({ set: query.set });
	if (query.verdict) params.set("verdict", query.verdict);
	if (query.cursor) params.set("cursor", query.cursor);
	return get(`/listings?${params}`, parseListingsPage);
}

/** One circuit's result page: its stored result, publication and live reads (a few seconds). */
export function fetchCircuit(
	processor: string,
	tokenId: string,
): Promise<CircuitPage> {
	return get(`/circuit/${processor}/${tokenId}`, parseCircuitPage);
}

/** The Check box: what was typed, to the one circuit it names (2026-11-22-check-box-input.md). */
export function fetchCheck(q: string): Promise<CheckAnswer> {
	return get(`/check?${new URLSearchParams({ q })}`, parseCheckAnswer);
}

/** A wallet's miners and their copy alerts, from the owner follow and a live RIG voucher read. */
export function fetchWallet(address: string): Promise<WalletMiners> {
	return get(`/wallet/${address}/miners`, parseWalletMiners);
}
