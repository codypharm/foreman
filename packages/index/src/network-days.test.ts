import { replayClient } from "@foreman/chain-bnb/fixture";
import fixture from "@foreman/chain-bnb/fixtures/bnb-network-days-134739204.json" with {
	type: "json",
};
import type pg from "pg";
import { afterEach, describe, expect, test } from "vitest";
import {
	followNetworkDays,
	readNetworkDays,
	saveNetworkDays,
} from "./index.ts";
import { freshDatabase, TEST_DATABASE_URL } from "./testing.ts";

// The verified network weight at the first block at or after 00:00 UTC each day, for the growth
// rates (docs/decisions/2026-11-20-growth-rates.md). The fixture is one follow to block
// 134,739,204 (20 Nov 2026, 13:18 UTC): the network on 19 and 20 November
// (packages/chain-bnb/scripts/record-network-days-fixture.ts).
const TO = 134_739_204n;
const DAY = 86_400n;
const NOV_18 = 1_794_960_000n;

/** A network sample as the backfill saves it: made up, but only its day and weight matter. */
const sample = (time: bigint, verifiedWeight: bigint) => ({
	verifiedWeight,
	unverifiedWeight: 41_000n,
	minerCount: 20_800n,
	verifiedMinerCount: 20_100n,
	readAt: { chainId: 56 as const, block: 134_200_000n, time },
});

describe.skipIf(!TEST_DATABASE_URL)("daily network samples", () => {
	let pool: pg.Pool | undefined;
	afterEach(async () => {
		await pool?.end();
	});

	test("the follow adds every day from the last one saved to the last midnight before its block", async () => {
		pool = await freshDatabase();
		await saveNetworkDays(pool, [sample(NOV_18, 1_600_000n)]);
		const result = await followNetworkDays(pool, replayClient(fixture), {
			toBlock: TO,
		});
		expect(result).toEqual({ followed: true, days: 2 });
		expect(await readNetworkDays(pool)).toEqual([
			{ time: NOV_18, block: 134_200_000n, verifiedWeight: 1_600_000n },
			{
				time: NOV_18 + DAY,
				block: 134_403_582n,
				verifiedWeight: 1_609_667n,
			},
			{
				time: NOV_18 + 2n * DAY,
				block: 134_595_494n,
				verifiedWeight: 1_614_135n,
			},
		]);
	});

	test("before the first fill the follow says so and reads nothing", async () => {
		pool = await freshDatabase();
		expect(
			await followNetworkDays(pool, replayClient(fixture), { toBlock: TO }),
		).toEqual({
			followed: false,
			detail: "not filled yet: run the network's first fill",
		});
	});

	test("a second follow at the same block adds nothing", async () => {
		pool = await freshDatabase();
		await saveNetworkDays(pool, [sample(NOV_18, 1_600_000n)]);
		await followNetworkDays(pool, replayClient(fixture), { toBlock: TO });
		expect(
			await followNetworkDays(pool, replayClient(fixture), { toBlock: TO }),
		).toEqual({ followed: true, days: 0 });
		expect(await readNetworkDays(pool)).toHaveLength(3);
	});

	test("saving the same day again is fine; a different sample for it is refused, and nothing is saved", async () => {
		pool = await freshDatabase();
		await saveNetworkDays(pool, [sample(NOV_18, 1_600_000n)]);
		await saveNetworkDays(pool, [sample(NOV_18, 1_600_000n)]);
		await expect(
			saveNetworkDays(pool, [
				sample(NOV_18 + DAY, 1_610_000n),
				sample(NOV_18 + 60n, 1_600_001n),
			]),
		).rejects.toThrow("a different network sample");
		expect(await readNetworkDays(pool)).toEqual([
			{ time: NOV_18, block: 134_200_000n, verifiedWeight: 1_600_000n },
		]);
	});
});
