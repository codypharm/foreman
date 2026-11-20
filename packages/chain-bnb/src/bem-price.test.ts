import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-bem-price.json" with { type: "json" };
import { replayClient } from "./fixture.ts";
import { readBemPrice } from "./index.ts";

// BEM's price in BNB from the BEM/WBNB pool (docs/decisions/2026-11-20-payback-and-bem-price.md).
// Expected values worked out in Python from the saved raw responses, not by this reader: the
// observe() tick cumulatives 1,545,019,431,059 and 1,545,362,116,666 give a mean tick of 190,380,
// and 1.0001^190,380 × 10^8 = 18,521,875,861,320,090.48 wei per BEM (the pool's tick maths gives
// the same whole wei). Recorded by scripts/record-bem-price-fixture.ts.

const client = replayClient(fixture);

describe("reading BEM's price in BNB", () => {
	test("is the pool's 30-minute average at the block, with what the pool holds", async () => {
		expect(await readBemPrice(client, { blockNumber: 134_739_204n })).toEqual({
			available: true,
			price: {
				bnbPerBem: EXPECTED.bnbPerBem,
				pool: "0x28b12792f9d81bd529bc5572434e861c9edbbbc2",
				averagedOver: 1800,
				poolBem: 474_238_142_846n,
				poolWbnb: 17_807_194_421_184_457_178n,
				readAt: { chainId: 56, block: 134_739_204n, time: EXPECTED.time },
			},
		});
	});

	test("is missing, never zero, at a block before the pool existed", async () => {
		expect(await readBemPrice(client, { blockNumber: 117_261_606n })).toEqual({
			available: false,
			reason: "The BEM/WBNB pool doesn't exist at this block",
			readAt: expect.objectContaining({ block: 117_261_606n }),
		});
	});

	test("is missing when the pool has less than 30 minutes of price history", async () => {
		expect(await readBemPrice(client, { blockNumber: 117_264_607n })).toEqual({
			available: false,
			reason: expect.stringMatching(
				/^The BEM\/WBNB pool has only \d+ seconds of price history; the average needs 1800$/,
			),
			readAt: expect.objectContaining({ block: 117_264_607n }),
		});
	});
});

const EXPECTED = { bnbPerBem: 18_521_875_861_320_090n, time: 1_795_197_496n };
