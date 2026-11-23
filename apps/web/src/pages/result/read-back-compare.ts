// How the result read from X Layer compares with this page's
// (docs/decisions/2026-11-23-same-verdict-read-back.md, decision 1). Computed in the browser with the
// publish job's own change fingerprint, so the read-back takes nothing from Foreman's API for it.

import { changeFingerprint } from "@foreman/chain-xlayer/results";
import { type Originality, serialiseOriginality } from "@foreman/contract";

/**
 * identical: byte for byte. same-verdict: a newer check whose verdict, evidence and can-mine state
 * are the published ones, so it isn't published again. changed: anything else, including no result
 * on the page.
 */
export type PageComparison = "identical" | "same-verdict" | "changed";

export function compareWithPage(
	logged: Originality,
	onPage: Originality | null,
): PageComparison {
	if (!onPage) return "changed";
	if (wire(logged) === wire(onPage)) return "identical";
	return changeFingerprint(logged) === changeFingerprint(onPage)
		? "same-verdict"
		: "changed";
}

/** The verdict in the product's words (CLAUDE.md, "Copy"), as plain text. */
export function verdictWords(o: Originality): string {
	const r = o.result;
	switch (r.verdict) {
		case "copy":
			return `Copy of circuit #${r.of.tokenId.toString()}`;
		case "wrapper": {
			const [first, ...more] = r.pointsTo;
			return `Wrapper of circuit #${first?.tokenId.toString()}${more.length ? ` and ${more.length} more` : ""}`;
		}
		case "too-small-to-tell":
			return "Too small to tell";
		case "no-earlier-copy":
			return "No earlier copy found";
		case "cant-check":
			return "Can’t check";
	}
}

const wire = (o: Originality) =>
	JSON.stringify(serialiseOriginality(o, "originality"));
