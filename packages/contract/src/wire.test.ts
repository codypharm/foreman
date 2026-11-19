import { describe, expect, test } from "vitest";
import {
	ContractParseError,
	parseAddress,
	parseHex32,
	parseUint,
	serialiseUint,
} from "./index.ts";

describe("a whole number on the wire", () => {
	test("is a decimal string of base units, read as a bigint", () => {
		// 51.69 BEM at 8 decimals
		expect(parseUint("5169000000", "range.base")).toBe(5_169_000_000n);
	});

	test("as a JSON number is refused, naming the field, because numbers lose precision", () => {
		expect(() => parseUint(5169000000, "range.base")).toThrow(
			ContractParseError,
		);
		expect(() => parseUint(5169000000, "range.base")).toThrow(/range\.base/);
	});

	test.each([
		["", "empty (BigInt would read it as zero)"],
		[" 12", "padded"],
		["-1", "negative"],
		["+1", "signed"],
		["0x10", "hex"],
		["1.5", "a fraction"],
		["1e3", "exponent notation"],
		["007", "leading zeros"],
	])("%j is refused: %s", (wire, _why) => {
		expect(() => parseUint(wire, "weight")).toThrow(ContractParseError);
	});

	test("zero itself is written as 0", () => {
		expect(parseUint("0", "weight")).toBe(0n);
	});

	test("is written back as the same decimal string, and reads back unchanged", () => {
		const weight = 1_609_667n * 10n ** 27n; // far past 2^53
		expect(serialiseUint(weight, "weight")).toBe(
			"1609667000000000000000000000000000",
		);
		expect(parseUint(serialiseUint(weight, "weight"), "weight")).toBe(weight);
	});

	test("that is negative is refused when writing", () => {
		expect(() => serialiseUint(-1n, "range.low")).toThrow(ContractParseError);
	});
});

const MINING = "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46";

describe("an address on the wire", () => {
	test("is lowercase 0x hex of 20 bytes", () => {
		expect(parseAddress(MINING, "processor")).toBe(MINING);
	});

	test.each([
		[MINING.slice(0, -2), "19 bytes"],
		[`${MINING}00`, "21 bytes"],
		[MINING.slice(2), "no 0x"],
		["0x7E2E0DC66A3BD9103E69B766AFA62D9F7B697B46", "uppercase"],
		["0x7e2e0dc66a3bd9103e69b766afa62d9f7b697bzz", "not hex"],
		[0, "a number"],
	])("%j is refused: %s", (wire, _why) => {
		expect(() => parseAddress(wire, "processor")).toThrow(ContractParseError);
	});
});

const CLAIMED_TOPIC =
	"0x0508a8b4117d9a7b3d8f5895f6413e61b4f9a2df35afbfb41e78d0ecfff1843f";

describe("a miner key or transaction hash on the wire", () => {
	test("is lowercase 0x hex of 32 bytes", () => {
		expect(parseHex32(CLAIMED_TOPIC, "minerKey")).toBe(CLAIMED_TOPIC);
	});

	test.each([
		[MINING, "an address is not a miner key"],
		[`${CLAIMED_TOPIC}00`, "33 bytes"],
		[CLAIMED_TOPIC.toUpperCase().replace("0X", "0x"), "uppercase"],
		[null, "null"],
	])("%j is refused: %s", (wire, _why) => {
		expect(() => parseHex32(wire, "minerKey")).toThrow(ContractParseError);
	});
});
