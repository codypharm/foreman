// The API's errors (docs/data-contract.md, "API responses"): plain words for the screen. An RPC
// failure is read-failed, an index that isn't loaded is not-ready; never a crash, a silent zero or
// a partial page.

import { ContractParseError } from "./errors.ts";
import { parseObject, parseOneOf, parseText } from "./wire.ts";

export const API_ERRORS = [
	"not-recognised",
	"unknown-circuit",
	"unknown-wallet-input",
	"read-failed",
	"not-ready",
] as const;

export type ApiError =
	| { error: "not-recognised"; detail: string; accepted: string[] }
	| {
			error: Exclude<(typeof API_ERRORS)[number], "not-recognised">;
			detail: string;
	  };

export function parseApiError(wire: unknown, field: string): ApiError {
	const w = parseObject(wire, field);
	const error = parseOneOf(w.error, `${field}.error`, API_ERRORS);
	const detail = parseText(w.detail, `${field}.detail`);
	if (error !== "not-recognised") {
		if ("accepted" in w) {
			throw new ContractParseError(
				`${field}.accepted`,
				"nothing: only not-recognised lists what the Check box accepts",
				w.accepted,
			);
		}
		return { error, detail };
	}
	if (!Array.isArray(w.accepted) || w.accepted.length === 0) {
		throw new ContractParseError(
			`${field}.accepted`,
			"what the Check box accepts, at least one",
			w.accepted,
		);
	}
	return {
		error,
		detail,
		accepted: w.accepted.map((a, i) => parseText(a, `${field}.accepted[${i}]`)),
	};
}

/** An error for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseApiError(
	error: ApiError,
	field: string,
): Record<string, unknown> {
	const wire =
		error.error === "not-recognised"
			? {
					error: error.error,
					detail: error.detail,
					accepted: [...error.accepted],
				}
			: { error: error.error, detail: error.detail };
	parseApiError(wire, field);
	return wire;
}
