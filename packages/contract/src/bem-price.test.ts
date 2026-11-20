import { describe, expect, test } from "vitest";
import { parseBemPrice, serialiseBemPrice } from "./index.ts";

// BEM's price in BNB for payback (docs/decisions/2026-11-20-payback-and-bem-price.md).

function wireBemPrice(overrides: Record<string, unknown> = {}) {
	// 0.0185 BNB a BEM, from the BEM/WBNB pool at block 134,739,204
	return {
		bnbPerBem: "18500000000000000",
		pool: "0x28b12792f9d81bd529bc5572434e861c9edbbbc2",
		averagedOver: 1800,
		poolBem: "474238142846",
		poolWbnb: "17807194421184457178",
		readAt: { chainId: 56, block: "134739204", time: "1795197496" },
		...overrides,
	};
}

describe("BEM's price in BNB on the wire", () => {
	test("is BNB wei per whole BEM, averaged over 30 minutes, with the pool and what it holds", () => {
		const price = parseBemPrice(wireBemPrice(), "bemPrice");
		expect(price).toEqual({
			bnbPerBem: 18_500_000_000_000_000n,
			pool: "0x28b12792f9d81bd529bc5572434e861c9edbbbc2",
			averagedOver: 1800,
			poolBem: 474_238_142_846n,
			poolWbnb: 17_807_194_421_184_457_178n,
			readAt: { chainId: 56, block: 134_739_204n, time: 1_795_197_496n },
		});
		expect(serialiseBemPrice(price, "bemPrice")).toEqual(wireBemPrice());
	});

	test.each([
		[
			{ bnbPerBem: "0" },
			"bemPrice.bnbPerBem",
			"zero: every payback would divide by it",
		],
		[{ averagedOver: 0 }, "bemPrice.averagedOver", "a spot price"],
		[
			{ averagedOver: 3600 },
			"bemPrice.averagedOver",
			"an average the rule didn't choose",
		],
		[
			{ pool: "0x28B12792F9D81Bd529Bc5572434E861C9EDbBBC2" },
			"bemPrice.pool",
			"a checksummed address",
		],
		[
			{ readAt: { chainId: 196, block: "1", time: "1" } },
			"bemPrice.readAt.chainId",
			"X Layer: the pool is on BNB Chain",
		],
	] as [Record<string, unknown>, string, string][])(
		"%j is refused at %s: %s",
		(overrides, field, _why) => {
			expect(() => parseBemPrice(wireBemPrice(overrides), "bemPrice")).toThrow(
				expect.objectContaining({ name: "ContractParseError", field }),
			);
		},
	);
});
