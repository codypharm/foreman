// "Original?": the stored verdict with the evidence anyone can re-check from chain data (CLAUDE.md,
// "Every verdict carries its evidence"). Facts, never accusations; never "original" on its own.

import type {
	CircuitRef,
	OriginalityFact,
	Originality as OriginalityResult,
	StoredCheck,
} from "@foreman/contract";
import type { ReactNode } from "react";
import { formatCount, formatDate, formatGap, shortHex } from "../../format.ts";
import { circuitName, designTime, processorLabel } from "./circuit-words.ts";
import s from "./ResultPage.module.css";

const LIMIT =
	"Checks identical netlists, including swapped gate inputs. A copy with its gates reordered isn’t detected.";

export function Originality({ check }: { check: StoredCheck }) {
	return (
		<section className={`${s.q} ${s.first}`} aria-label="Original?">
			<div className={s.sec}>
				<h2>Original?</h2>
				{check.state === "checked" && (
					<span className={s.meta}>
						{formatCount(check.originality.index.circuitsChecked)} circuits
						checked · BNB block{" "}
						{formatCount(check.originality.index.upToBlock.block)}
					</span>
				)}
			</div>
			{check.state === "not-checked" ? (
				<Verdict mark={<UnknownMark />} title="Can’t check yet">
					{check.detail}
				</Verdict>
			) : (
				<Checked result={check.originality} />
			)}
			<p className={s.limit}>
				<b>The earliest proven design is the original.</b> {LIMIT}
			</p>
		</section>
	);
}

function Checked({ result: o }: { result: OriginalityResult }) {
	const r = o.result;
	const me = o.circuit;
	const sharedMiners = fact(o.facts, "design-shared")?.miners;
	const minersRow = sharedMiners !== undefined && (
		<Row label="Miners on this design">{formatCount(sharedMiners)}</Row>
	);
	const usesRef = fact(o.facts, "uses-ref");
	const usesRefLine = usesRef && (
		<>
			{" "}
			{formatCount(usesRef.borrowedGates)} of its{" "}
			{formatCount(usesRef.totalGates)} gates come from other circuits.
		</>
	);

	switch (r.verdict) {
		case "copy": {
			const mine = designTime(me);
			const theirs = designTime(r.of);
			const sameAddress = fact(o.facts, "tape-out-address")?.same === true;
			const gap = mine.time - theirs.time;
			return (
				<>
					<Verdict
						mark={<CopyMark />}
						title={`Copy of circuit ${circuitName(r.of)}`}
					>
						{r.bytesIdentical
							? "Byte-identical netlist"
							: "Identical netlist once swapped gate inputs are put in order"}
						,{" "}
						{gap > 0n ? (
							<>
								designed <b>{formatGap(gap)} earlier</b>
							</>
						) : (
							"designed earlier in the same block"
						)}{" "}
						on {processorLabel(r.of.processor)}.
						{sameAddress && " Taped out by the same address."}
					</Verdict>
					<ul className={s.evidence}>
						<DesignedRow c={r.of} />
						<DesignedRow c={me} />
						<Row label="Netlist hash, both">
							<span className={s.mono}>{shortHex(r.netlistHash)}</span>
							<small>
								{r.bytesIdentical
									? "identical bytes"
									: "identical with gate inputs in order"}
							</small>
						</Row>
						{sameAddress && (
							<Row label="Taped out by">
								<span className={s.mono}>{shortHex(me.tapedOutBy)}</span>
								<small>both circuits</small>
							</Row>
						)}
						{minersRow}
					</ul>
				</>
			);
		}
		case "too-small-to-tell": {
			const earliest = designTime(r.earliest);
			return (
				<>
					<Verdict mark={<SmallMark />} title="Too small to tell">
						Identical to{" "}
						<b>
							{formatCount(r.sameAs)} earlier circuit{r.sameAs === 1 ? "" : "s"}
						</b>
						, below the size floor of {r.floor} gates. The earliest is circuit{" "}
						{circuitName(r.earliest)},{" "}
						{earliest.by === "commitment" ? "designed" : "taped out"}{" "}
						{formatDate(earliest.time)}.
					</Verdict>
					<ul className={s.evidence}>
						<Row label="This netlist">
							{formatCount(r.gateCount)} gate{r.gateCount === 1 ? "" : "s"}
							<small>size floor {r.floor} gates</small>
						</Row>
						<DesignedRow c={r.earliest} />
						<DesignedRow c={me} />
						<Row label={`Netlist hash, all ${formatCount(r.sameAs + 1)}`}>
							<span className={s.mono}>{shortHex(r.netlistHash)}</span>
						</Row>
						{minersRow}
					</ul>
				</>
			);
		}
		case "wrapper": {
			const [first, ...more] = r.pointsTo;
			const also = fact(o.facts, "also-identical");
			return (
				<>
					<Verdict
						mark={<WrapperMark />}
						title={`Wrapper of circuit ${first ? circuitName(first) : ""}`}
					>
						Its netlist is only REF records, pointing to{" "}
						{list(r.pointsTo.map(circuitName))}. The gates are in{" "}
						<b>{list(r.finalTargets.map(circuitName))}</b>
						{r.chainSteps > 1 && `, ${r.chainSteps} steps along`}.
						{also && ` Also identical to circuit ${circuitName(also.to)}.`}
					</Verdict>
					<ul className={s.evidence}>
						<Row label="Points to">
							{list(r.pointsTo.map(circuitName))}
							{more.length > 0 && (
								<small>{formatCount(r.pointsTo.length)} circuits</small>
							)}
						</Row>
						<Row label="Gates held by">
							{list(r.finalTargets.map(circuitName))}
							<small>
								{r.chainSteps} step{r.chainSteps === 1 ? "" : "s"} along
							</small>
						</Row>
						<DesignedRow c={me} />
						{also && (
							<Row label="Netlist hash">
								<span className={s.mono}>{shortHex(also.netlistHash)}</span>
								<small>same as {circuitName(also.to)}</small>
							</Row>
						)}
						{minersRow}
					</ul>
				</>
			);
		}
		case "no-earlier-copy":
			return (
				<>
					<Verdict mark={<NoCopyMark />} title="No earlier copy found">
						No earlier circuit among{" "}
						<b>{formatCount(o.index.circuitsChecked)} checked</b>, up to BNB
						block {formatCount(o.index.upToBlock.block)}, has the same netlist.
						{usesRefLine}
					</Verdict>
					<ul className={s.evidence}>
						<DesignedRow c={me} />
						<Row label="Netlist hash">
							<span className={s.mono}>{shortHex(r.netlistHash)}</span>
						</Row>
						{minersRow}
					</ul>
				</>
			);
		case "cant-check":
			return (
				<Verdict mark={<UnknownMark />} title="Can’t check">
					{CANT_CHECK[r.reason](o)}
				</Verdict>
			);
	}
}

const CANT_CHECK: Record<
	Extract<OriginalityResult["result"], { verdict: "cant-check" }>["reason"],
	(o: OriginalityResult) => string
> = {
	"netlist-unreadable": () =>
		"Its netlist couldn’t be read, so it can’t be compared.",
	"outside-index": (o) =>
		`It isn’t in the index of ${formatCount(o.index.circuitsChecked)} circuits up to BNB block ${formatCount(o.index.upToBlock.block)}.`,
	"read-failed": () => "Reading its netlist failed. It will be checked again.",
	"ref-chain-too-long": () =>
		"Its REF records chain more than 10 steps, further than Foreman follows.",
};

function Verdict({
	mark,
	title,
	children,
}: {
	mark: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className={s.verdict}>
			<span className={s.vmark}>{mark}</span>
			<div>
				<h3>{title}</h3>
				<p>{children}</p>
			</div>
		</div>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<li>
			<span>{label}</span>
			<b>{children}</b>
		</li>
	);
}

/** "#13056 designed · 6 Sep 2026 · BNB block 120,314,137 · processor ×1" */
function DesignedRow({ c }: { c: CircuitRef }) {
	const t = designTime(c);
	return (
		<Row
			label={`${circuitName(c)} ${t.by === "commitment" ? "designed" : "taped out"}`}
		>
			{formatDate(t.time)}
			<small>
				BNB block {formatCount(t.block)} ·{" "}
				{t.by === "commitment"
					? "design commitment"
					: processorLabel(c.processor)}
			</small>
		</Row>
	);
}

function fact<K extends OriginalityFact["fact"]>(
	facts: OriginalityFact[],
	kind: K,
): Extract<OriginalityFact, { fact: K }> | undefined {
	return facts.find(
		(f): f is Extract<OriginalityFact, { fact: K }> => f.fact === kind,
	);
}

/** "#1, #2 and #3" */
function list(items: string[]): string {
	return items.length <= 1
		? (items[0] ?? "")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const svg = (children: ReactNode) => (
	<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
		{children}
	</svg>
);
const line = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.6,
} as const;
const CopyMark = () =>
	svg(
		<>
			<rect x="2" y="5" width="9" height="11" rx="2" {...line} />
			<rect x="7" y="2" width="9" height="11" rx="2" {...line} />
		</>,
	);
const SmallMark = () =>
	svg(
		<>
			<rect x="3" y="3" width="12" height="12" rx="2.5" {...line} />
			<path d="M6.5 9h5" {...line} strokeLinecap="round" />
		</>,
	);
const WrapperMark = () =>
	svg(
		<>
			<rect
				x="2"
				y="2"
				width="14"
				height="14"
				rx="2.5"
				{...line}
				strokeDasharray="2.5 2"
			/>
			<rect x="6" y="6" width="6" height="6" rx="1.5" {...line} />
		</>,
	);
const NoCopyMark = () =>
	svg(<rect x="3" y="3" width="12" height="12" rx="2.5" {...line} />);
const UnknownMark = () =>
	svg(
		<>
			<circle cx="9" cy="9" r="6.5" {...line} />
			<path d="M9 5.5v4.5M9 12.5v.01" {...line} strokeLinecap="round" />
		</>,
	);
