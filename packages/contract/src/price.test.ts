import { describe, expect, test } from "vitest";
import { parsePrice, serialisePrice } from "./index.ts";

function wirePrice(overrides: Record<string, unknown> = {}) {
	// $20.50 a BEM
	return {
		usdPerBem: "2050000000",
		source: "price feed",
		readAt: "1795000000",
		...overrides,
	};
}

describe("the BEM price on the wire", () => {
	test("is US dollars per BEM at 8 decimals, with its source and when it was read", () => {
		expect(parsePrice(wirePrice(), "price")).toEqual({
			usdPerBem: 2_050_000_000n,
			source: "price feed",
			readAt: 1_795_000_000n,
		});
	});

	test.each([
		[
			{ usdPerBem: "0" },
			"price.usdPerBem",
			"zero: every dollar figure would read $0.00",
		],
		[{ usdPerBem: 20.5 }, "price.usdPerBem", "a JSON number"],
		[
			{ usdPerBem: "20.50" },
			"price.usdPerBem",
			"dollars, not 8-decimal base units",
		],
		[{ source: "" }, "price.source", "a price from nowhere"],
		[
			{ readAt: undefined },
			"price.readAt",
			"no age, so staleness cannot be shown",
		],
	])("%j is refused at %s: %s", (overrides, field, _why) => {
		expect(() => parsePrice(wirePrice(overrides), "price")).toThrow(
			expect.objectContaining({ name: "ContractParseError", field }),
		);
	});

	test("written to the wire reads back unchanged", () => {
		const price = parsePrice(wirePrice(), "price");
		const sent = JSON.parse(JSON.stringify(serialisePrice(price, "price")));
		expect(sent).toEqual(wirePrice());
		expect(parsePrice(sent, "price")).toEqual(price);
	});
});
