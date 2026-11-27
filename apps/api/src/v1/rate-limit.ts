// Calls a minute per API key, counted per clock minute in this process's memory: the API runs as one
// process. 60 (docs/decisions/2026-11-26-api-keys.md, decision 6), or 600 for a key whose wallet paid
// (2026-11-26-paid-api-tier.md, decision 1). The caller says which, call by call.

export const CALLS_PER_MINUTE = 60;
export const PAID_CALLS_PER_MINUTE = 600;

export type Admit = { ok: true } | { ok: false; retryAfterSeconds: number };

export function rateLimiter(
	now: () => number,
): (keyId: number, limit: number) => Admit {
	const minutes = new Map<number, { minute: number; calls: number }>();
	return (keyId, limit) => {
		const t = now();
		const minute = Math.floor(t / 60_000);
		const seen = minutes.get(keyId);
		if (!seen || seen.minute !== minute) {
			minutes.set(keyId, { minute, calls: 1 });
			return { ok: true };
		}
		if (seen.calls >= limit) {
			return {
				ok: false,
				retryAfterSeconds: Math.ceil(((minute + 1) * 60_000 - t) / 1000),
			};
		}
		seen.calls++;
		return { ok: true };
	};
}
