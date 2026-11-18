/** Thrown when an input cannot produce a meaningful valuation. Never replaced by a zero. */
export class ValuationInputError extends Error {
	override name = "ValuationInputError";
}
