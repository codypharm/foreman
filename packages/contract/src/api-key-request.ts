// Making an API key on the API page (docs/decisions/2026-11-26-self-serve-api-keys.md): the
// message a wallet signs, the request the page sends, and the key that comes back once. The page builds
// the message with apiKeyMessage and the API rebuilds it the same way, so the two can't drift apart.

import { ContractParseError } from "./errors.ts";
import {
	type Address,
	parseAddress,
	parseObject,
	parseText,
	parseUint,
	serialiseUint,
} from "./wire.ts";

/** How old a signed message may be when it reaches the API. */
export const API_KEY_MESSAGE_MAX_AGE_SECONDS = 600;

/** The message a wallet signs to make its key: its address and the time, and that it sends nothing. */
export function apiKeyMessage(wallet: Address, signedAt: Date): string {
	return [
		`Make a Foreman API key for ${wallet.toLowerCase()}`,
		`Time: ${signedAt.toISOString()}`,
		"Signing is free: it sends no transaction. A new key ends this wallet's old one.",
	].join("\n");
}

export interface ApiKeyRequest {
	wallet: Address;
	/** The time inside the signed message. */
	signedAt: Date;
	message: string;
	signature: `0x${string}`;
}

export interface ApiKeyAnswer {
	wallet: Address;
	/** Shown once: Foreman keeps only its hash. */
	key: string;
}

export function parseApiKeyRequest(
	wire: unknown,
	field: string,
): ApiKeyRequest {
	const w = parseObject(wire, field);
	const wallet = parseAddress(
		typeof w.wallet === "string" ? w.wallet.toLowerCase() : w.wallet,
		`${field}.wallet`,
	);
	const message = parseText(w.message, `${field}.message`);
	const time = /\nTime: (\S+)\n/.exec(message)?.[1];
	const signedAt = time ? new Date(time) : null;
	if (
		!signedAt ||
		Number.isNaN(signedAt.getTime()) ||
		apiKeyMessage(wallet, signedAt) !== message
	) {
		throw new ContractParseError(
			`${field}.message`,
			"Foreman's key message for this wallet, unchanged",
			message.slice(0, 80),
		);
	}
	const signature = parseText(w.signature, `${field}.signature`);
	if (!/^0x[0-9a-f]+$/i.test(signature)) {
		throw new ContractParseError(
			`${field}.signature`,
			"a 0x hexadecimal signature",
			signature.slice(0, 20),
		);
	}
	return {
		wallet,
		signedAt,
		message,
		signature: signature as `0x${string}`,
	};
}

/** For the wire, as the page sends it. */
export function serialiseApiKeyRequest(
	request: Omit<ApiKeyRequest, "signedAt">,
	field: string,
): Record<string, unknown> {
	const wire = {
		wallet: request.wallet,
		message: request.message,
		signature: request.signature,
	};
	parseApiKeyRequest(wire, field);
	return wire;
}

export function parseApiKeyAnswer(wire: unknown, field: string): ApiKeyAnswer {
	const w = parseObject(wire, field);
	const key = parseText(w.key, `${field}.key`);
	if (!/^fmn_[A-Za-z0-9_-]{32}$/.test(key)) {
		throw new ContractParseError(`${field}.key`, "a Foreman API key", "…");
	}
	return { wallet: parseAddress(w.wallet, `${field}.wallet`), key };
}

export function serialiseApiKeyAnswer(
	answer: ApiKeyAnswer,
	field: string,
): Record<string, unknown> {
	const wire = { wallet: answer.wallet, key: answer.key };
	parseApiKeyAnswer(wire, field);
	return wire;
}

/**
 * Whether a wallet has a live key made by signature, for the API page: when it was made, never the
 * key (Foreman keeps only its hash). `madeAt` is Unix seconds; null when the wallet has no live key.
 */
export interface ApiKeyStatus {
	wallet: Address;
	madeAt: bigint | null;
	/** The key's last 4 characters, so the page can say which key it is; null when the wallet has no
	 * key, or for a key made before endings were kept (docs/decisions/2026-11-27-key-ending.md). */
	keyEnding: string | null;
	/** When the wallet's paid API tier ends (Unix seconds); null when it never paid or it has ended
	 * (docs/decisions/2026-11-26-paid-api-tier.md, decision 7). */
	paidUntil: bigint | null;
}

export function parseApiKeyStatus(wire: unknown, field: string): ApiKeyStatus {
	const w = parseObject(wire, field);
	if ("key" in w) {
		throw new ContractParseError(
			`${field}.key`,
			"no key: a key is shown only once",
			"…",
		);
	}
	if (!("keyEnding" in w)) {
		throw new ContractParseError(
			`${field}.keyEnding`,
			"4 characters or null",
			"missing",
		);
	}
	const keyEnding = w.keyEnding;
	if (
		keyEnding !== null &&
		!(typeof keyEnding === "string" && /^[A-Za-z0-9_-]{4}$/.test(keyEnding))
	) {
		throw new ContractParseError(
			`${field}.keyEnding`,
			"a key's last 4 characters, or null",
			String(keyEnding).slice(0, 8),
		);
	}
	if (keyEnding !== null && w.madeAt === null) {
		throw new ContractParseError(
			`${field}.keyEnding`,
			"null for a wallet with no key",
			keyEnding,
		);
	}
	if (!("paidUntil" in w)) {
		throw new ContractParseError(
			`${field}.paidUntil`,
			"a time or null",
			"missing",
		);
	}
	return {
		wallet: parseAddress(w.wallet, `${field}.wallet`),
		madeAt: w.madeAt === null ? null : parseUint(w.madeAt, `${field}.madeAt`),
		keyEnding,
		paidUntil:
			w.paidUntil === null
				? null
				: parseUint(w.paidUntil, `${field}.paidUntil`),
	};
}

export function serialiseApiKeyStatus(
	status: ApiKeyStatus,
	field: string,
): Record<string, unknown> {
	const wire = {
		wallet: status.wallet,
		madeAt:
			status.madeAt === null
				? null
				: serialiseUint(status.madeAt, `${field}.madeAt`),
		keyEnding: status.keyEnding,
		paidUntil:
			status.paidUntil === null
				? null
				: serialiseUint(status.paidUntil, `${field}.paidUntil`),
	};
	parseApiKeyStatus(wire, field);
	return wire;
}
