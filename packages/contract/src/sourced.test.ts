import { describe, expect, test } from "vitest";
import {
	ContractParseError,
	parseSourced,
	parseUint,
	serialiseSourced,
	serialiseUint,
} from "./index.ts";

describe("a value read from the chain", () => {
	test("carries the chain and the block it was read at", () => {
		const wire = {
			value: "1609667",
			source: "chain",
			chainId: 56,
			block: "134351215",
		};
		expect(parseSourced(wire, "inputs.networkWeight", parseUint)).toEqual({
			value: 1_609_667n,
			source: "chain",
			chainId: 56,
			block: 134_351_215n,
		});
	});

	test.each([
		[{ value: "1609667", chainId: 56, block: "134351215" }, "no source"],
		[
			{ value: "1609667", source: "model", chainId: 56, block: "1" },
			"an unknown source",
		],
		[
			{ value: "1609667", source: "chain", chainId: 1, block: "1" },
			"a chain Foreman does not read",
		],
		[{ value: "1609667", source: "chain", chainId: 56 }, "no block"],
		[{ source: "chain", chainId: 56, block: "1" }, "no value"],
		[null, "null"],
		["1609667", "a bare value"],
	])("is refused with %s", (wire, _why) => {
		expect(() => parseSourced(wire, "inputs.networkWeight", parseUint)).toThrow(
			ContractParseError,
		);
	});
});

describe("a sourced value on the wire", () => {
	test("written from the chain reads back the same, block and all", () => {
		const sourced = {
			value: 1_609_667n,
			source: "chain" as const,
			chainId: 56 as const,
			block: 134_351_215n,
		};
		const wire = JSON.parse(
			JSON.stringify(
				serialiseSourced(sourced, "inputs.networkWeight", serialiseUint),
			),
		);
		expect(wire).toEqual({
			value: "1609667",
			source: "chain",
			chainId: 56,
			block: "134351215",
		});
		expect(parseSourced(wire, "inputs.networkWeight", parseUint)).toEqual(
			sourced,
		);
	});

	test("that fails names the full path to the bad field", () => {
		const wire = { value: 1609667, source: "chain", chainId: 56, block: "1" };
		try {
			parseSourced(wire, "inputs.networkWeight", parseUint);
			expect.unreachable();
		} catch (error) {
			expect((error as ContractParseError).field).toBe(
				"inputs.networkWeight.value",
			);
		}
	});
});

describe("a contract constant", () => {
	test("names the constant it is", () => {
		const wire = {
			value: "8333333",
			source: "constant",
			ref: "PodMining.INITIAL_RATE",
		};
		expect(parseSourced(wire, "inputs.emissionRate", parseUint)).toEqual({
			value: 8_333_333n,
			source: "constant",
			ref: "PodMining.INITIAL_RATE",
		});
	});

	test.each([
		{ value: "8333333", source: "constant" },
		{ value: "8333333", source: "constant", ref: " " },
	])("is refused without a reference: %j", (wire) => {
		expect(() => parseSourced(wire, "inputs.emissionRate", parseUint)).toThrow(
			ContractParseError,
		);
	});
});

describe("an assumption", () => {
	test("states its basis", () => {
		const wire = {
			value: "4000",
			source: "assumption",
			basis: "growth measured over the last 14 days",
		};
		expect(parseSourced(wire, "inputs.growthPpm.base", parseUint)).toEqual({
			value: 4_000n,
			source: "assumption",
			basis: "growth measured over the last 14 days",
		});
	});

	test("written to the wire reads back the same", () => {
		const sourced = {
			value: 4_000n,
			source: "assumption" as const,
			basis: "growth measured over the last 14 days",
		};
		const wire = JSON.parse(
			JSON.stringify(serialiseSourced(sourced, "g", serialiseUint)),
		);
		expect(parseSourced(wire, "g", parseUint)).toEqual(sourced);
	});

	test("is refused without a basis", () => {
		const wire = { value: "4000", source: "assumption", basis: "" };
		expect(() =>
			parseSourced(wire, "inputs.growthPpm.base", parseUint),
		).toThrow(ContractParseError);
	});
});
