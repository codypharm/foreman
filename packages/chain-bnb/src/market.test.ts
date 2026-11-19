import { describe, expect, test } from "vitest";
import fixture from "../fixtures/bnb-market-134486640.json" with {
	type: "json",
};
import { replayClient } from "./fixture.ts";
import { readActiveListings, readListing, readSales } from "./index.ts";

// TapeOut's circuit market at BNB block 134,486,640 (19 Nov 2026). Expected values were
// read with raw eth_call and eth_getLogs, not by this reader.
const client = replayClient(fixture);
const BLOCK = 134_486_640n;
const SELLER = "0xfa7524e6751bff29240ed6632d063c2369f33ec6";
const PROCESSOR = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";

describe("a listing on TapeOut's circuit market", () => {
	test("is an ask: seller, miner, price in BNB wei and the market's fee", async () => {
		expect(await readListing(client, 28_081n, { blockNumber: BLOCK })).toEqual({
			listingId: 28_081n,
			seller: SELLER,
			processor: PROCESSOR,
			tokenId: 2_369n,
			priceWei: 2_380_000_000_000_000_000n,
			feeBps: 100,
		});
	});

	test("that sold or was withdrawn is gone, not a zero-price ask", async () => {
		expect(
			await readListing(client, 28_083n, { blockNumber: BLOCK }),
		).toBeNull();
	});
});

describe("the market's open asks", () => {
	test("are every listing still open among the latest ids, newest first", async () => {
		const asks = await readActiveListings(client, {
			blockNumber: BLOCK,
			latest: 20,
		});
		// Read independently: ids 28064–28083, of which these are still open
		expect(asks.map((a) => a.listingId)).toEqual(
			[
				28064, 28065, 28066, 28068, 28069, 28070, 28071, 28072, 28074, 28075,
				28076, 28077, 28078, 28079, 28080, 28081,
			]
				.map(BigInt)
				.reverse(),
		);
	});
});

describe("completed sales on TapeOut's circuit market", () => {
	test("give what the buyer paid (seller proceeds + fee), oldest first", async () => {
		const sales = await readSales(client, {
			fromBlock: 134_476_000n,
			toBlock: 134_483_100n,
		});
		expect(sales).toEqual([
			{
				listingId: 28_082n,
				buyer: "0xe10d2506d704d7ebadead8dbe9f247008afc9f98",
				processor: "0xc38c95899cd21522ef5db37cd6be4cb422cef58a",
				tokenId: 502n,
				priceWei: 380_000_000_000_000_000n,
				feeWei: 3_800_000_000_000_000n,
				block: 134_476_085n,
				tx: "0xf18e34efa47adce14536799025f20ee06053269747f24ae1cd76a88596f91e7c",
			},
			{
				listingId: 28_083n,
				buyer: "0xd458e616a2d5606e2ae454fe7005d90de6e49303",
				processor: "0xc38c95899cd21522ef5db37cd6be4cb422cef58a",
				tokenId: 490n,
				priceWei: 379_000_000_000_000_000n,
				feeWei: 3_790_000_000_000_000n,
				block: 134_483_037n,
				tx: "0xad1c5da676c26dafe1acea1b81a89a2d74379e051d894c20c2f4facf8fc20ff1",
			},
		]);
	});
});
