import { describe, expect, test } from "vitest";
import {
	CALLS_PER_MINUTE,
	PAID_CALLS_PER_MINUTE,
	rateLimiter,
} from "./rate-limit.ts";

// Calls a minute per key (2026-11-26-api-keys.md, decision 6), and 10× that for a key whose wallet
// paid (2026-11-26-paid-api-tier.md, decision 1).

describe("the per-key limiter", () => {
	test("takes as many calls a minute as the limit it's given, and refuses the next", () => {
		expect(CALLS_PER_MINUTE).toBe(60);
		expect(PAID_CALLS_PER_MINUTE).toBe(600);
		const t = Date.UTC(2026, 10, 27, 12, 0, 15);
		const admit = rateLimiter(() => t);
		for (let i = 0; i < 600; i++)
			expect(admit(1, PAID_CALLS_PER_MINUTE).ok).toBe(true);
		expect(admit(1, PAID_CALLS_PER_MINUTE)).toEqual({
			ok: false,
			retryAfterSeconds: 45,
		});
		// Another key has its own count
		for (let i = 0; i < 60; i++)
			expect(admit(2, CALLS_PER_MINUTE).ok).toBe(true);
		expect(admit(2, CALLS_PER_MINUTE).ok).toBe(false);
	});

	test("a key whose limit drops mid-minute is refused once past the lower one", () => {
		const t = Date.UTC(2026, 10, 27, 12, 0, 0);
		const admit = rateLimiter(() => t);
		for (let i = 0; i < 100; i++)
			expect(admit(1, PAID_CALLS_PER_MINUTE).ok).toBe(true);
		expect(admit(1, CALLS_PER_MINUTE).ok).toBe(false);
	});
});
