// 60 calls a minute per API key (docs/decisions/2026-11-26-api-keys.md, decision 6), counted per
// clock minute in this process's memory: the API runs as one process.

export const CALLS_PER_MINUTE = 60;

export type Admit = { ok: true } | { ok: false; retryAfterSeconds: number };

export function rateLimiter(now: () => number): (keyId: number) => Admit {
	const minutes = new Map<number, { minute: number; calls: number }>();
	return (keyId) => {
		const t = now();
		const minute = Math.floor(t / 60_000);
		const seen = minutes.get(keyId);
		if (!seen || seen.minute !== minute) {
			minutes.set(keyId, { minute, calls: 1 });
			return { ok: true };
		}
		if (seen.calls >= CALLS_PER_MINUTE) {
			return {
				ok: false,
				retryAfterSeconds: Math.ceil(((minute + 1) * 60_000 - t) / 1000),
			};
		}
		seen.calls++;
		return { ok: true };
	};
}
