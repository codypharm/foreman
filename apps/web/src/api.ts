// The Foreman API, read through the data contract's own parsers: the app never renders a response the
// contract would refuse. Errors come back as the contract's ApiError, never a crash or a silent empty.

import {
	type ApiError,
	type ListingsPage,
	type ListingVerdict,
	parseApiError,
	parseListingsPage,
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
	return parse(body, "page");
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
