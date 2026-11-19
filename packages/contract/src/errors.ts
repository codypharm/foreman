/** Thrown when a value on the wire does not match the data contract. Never replaced by a zero. */
export class ContractParseError extends Error {
	override name = "ContractParseError";
	readonly field: string;

	constructor(field: string, expected: string, got: unknown) {
		super(`${field}: expected ${expected}, got ${describe(got)}`);
		this.field = field;
	}
}

function describe(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "bigint") return `${value}n`;
	if (value === null) return "null";
	if (typeof value === "object")
		return Array.isArray(value) ? "an array" : "an object";
	return `${typeof value} ${String(value)}`;
}
