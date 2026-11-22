// A circuit's verdict in one line, in the product's words (CLAUDE.md, "Copy"). Facts, never accusations.

import type { StoredCheck } from "@foreman/contract";
import { formatCount } from "../format.ts";

export function VerdictLine({ check }: { check: StoredCheck }) {
	// No stored result yet: shown as "Can't check", never as a verdict
	if (check.state === "not-checked") return <>Can’t check</>;
	const { result, facts } = check.originality;
	switch (result.verdict) {
		case "copy": {
			const same = facts.some((f) => f.fact === "tape-out-address" && f.same);
			return (
				<>
					<b>Copy of #{result.of.tokenId.toString()}</b>
					{same && " · same address"}
				</>
			);
		}
		case "wrapper": {
			const [first, ...more] = result.pointsTo;
			return (
				<>
					<b>Wrapper of #{first?.tokenId.toString()}</b>
					{more.length > 0 && ` and ${more.length} more`}
				</>
			);
		}
		case "too-small-to-tell":
			return (
				<>
					Too small to tell · identical to {formatCount(result.sameAs)} earlier
				</>
			);
		case "no-earlier-copy":
			return <>No earlier copy found</>;
		case "cant-check":
			return <>Can’t check</>;
	}
}
