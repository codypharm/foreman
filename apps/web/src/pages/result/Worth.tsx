// "Worth?" and "What it's based on": the miner's estimated output as low / base / high from its own
// weight, with every input and where it came from (CLAUDE.md, "No chain data, no number", "Ranges, not
// prices", "No invented copy discount"). The values come from the API; this only formats them.

import type { CircuitPage, Sourced, Valuation } from "@foreman/contract";
import { type ReactNode, useState } from "react";
import {
	formatAmount,
	formatAsk,
	formatBem,
	formatBemPerDay,
	formatCount,
	formatPpmPercent,
	formatShare,
} from "../../format.ts";
import s from "./ResultPage.module.css";
import { backtestWords, growthWords } from "./worth-words.ts";

/** The verified pool's share of emission (CLAUDE.md, "On-chain facts", "Emission"). Only verified miners are valued. */
const VERIFIED_SHARE = 99n;

const WINDOWS = {
	"30d": { tab: "30 days", label: "next 30 days" },
	"to-2030-halving": {
		tab: "To 2030 halving",
		label: "until the 2030 halving",
	},
} as const;

export function Worth({ page }: { page: CircuitPage }) {
	const [window, setWindow] = useState<keyof typeof WINDOWS>("30d");
	const hold = page.hold;
	return (
		<>
			<section className={s.q} aria-label="Worth?">
				<div className={s.sec}>
					<h2>Worth?</h2>
					<span className={s.meta}>From this miner’s own weight</span>
				</div>
				{hold.state === "shown" ? (
					<>
						<div className={s.seg} role="tablist" aria-label="Window">
							{(Object.keys(WINDOWS) as (keyof typeof WINDOWS)[]).map((w) => (
								<button
									key={w}
									type="button"
									role="tab"
									aria-selected={window === w}
									onClick={() => setWindow(w)}
								>
									{WINDOWS[w].tab}
								</button>
							))}
						</div>
						<Estimate
							v={window === "30d" ? hold.thirtyDays : hold.toHalving}
							page={page}
						/>
					</>
				) : hold.state === "not-valued" ? (
					<p className={s.quiet}>Not valued. {hold.reason}</p>
				) : (
					<p className={s.quiet}>
						Not mining, so it earns no BEM and has no estimated output.
					</p>
				)}
				<Payback page={page} />
			</section>
			{hold.state === "shown" && <Inputs v={hold.thirtyDays} page={page} />}
		</>
	);
}

function Estimate({ v, page }: { v: Valuation; page: CircuitPage }) {
	const { low, base, high } = v.range;
	// The bar runs from 0 to a little past the high case, so the span and the base read in proportion
	const max = Number(high) * 1.15 || 1;
	const at = (x: bigint) => `${(Number(x) / max) * 100}%`;
	const lostBonus =
		v.inputs.minerWeight.low.value < v.inputs.minerWeight.base.value;
	const growth = v.inputs.growthPpm;
	return (
		<>
			<p className={s.lbl}>Estimated output, {WINDOWS[v.window.label].label}</p>
			<div className={s.num}>
				<strong>{formatBem(base)}</strong>
				<span>BEM</span>
			</div>
			{"bnbPerBem" in page.bemPrice ? (
				<p className={s.usd}>
					≈{" "}
					{formatAmount(
						{
							currency: "BNB",
							value: (base * page.bemPrice.bnbPerBem) / 10n ** 8n,
						},
						2,
					)}{" "}
					at the BEM pool’s 30-minute average
				</p>
			) : (
				<p className={s.usd}>No BEM price right now, so no BNB figure</p>
			)}
			<div className={s.range}>
				<div className={s.bar} aria-hidden="true">
					<i className={s.t} />
					<i
						className={s.s}
						style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }}
					/>
					<i className={s.b} style={{ left: at(base) }} />
				</div>
				<div className={s.ends}>
					<div>
						<span>Low</span>
						<b>{formatBem(low, "down")}</b>
						<small>
							{lostBonus && "Design bonus lost, "}
							{lostBonus
								? growthWords(growth.low.value).replace(/^N/, "n")
								: growthWords(growth.low.value)}
						</small>
					</div>
					<div>
						<span>High</span>
						<b>{formatBem(high, "up")}</b>
						<small>{growthWords(growth.high.value)}</small>
					</div>
				</div>
			</div>
			<Backtest v={v} />
		</>
	);
}

/** How often the 30-day range held in the past; the halving view isn't backtested. */
function Backtest({ v }: { v: Valuation }) {
	const words = backtestWords(v.model.backtest, v.window.label);
	if (words === null) {
		return (
			<p className={s.held}>
				<b>Not backtested:</b> there isn’t enough history yet to test a forecast
				to 2030.
			</p>
		);
	}
	if (words === "pending") {
		return <p className={s.held}>Not backtested yet.</p>;
	}
	return (
		<p className={s.held}>
			Range held in <b>{words.held}</b> {words.rest}
		</p>
	);
}

function Payback({ page }: { page: CircuitPage }) {
	const p = page.payback;
	const asking = page.listing && (
		<div>
			<span>Asking</span>
			<b>{formatAsk(page.listing.ask)}</b>
		</div>
	);
	if (p.state === "not-listed") {
		return (
			<div className={s.ask}>
				<span>Not listed, so there’s no asking price to pay back.</span>
			</div>
		);
	}
	let words: string;
	switch (p.state) {
		case "shown":
			words = paybackDays(p.days);
			break;
		case "not-mining":
			words = "Not mining, so nothing pays it back";
			break;
		case "no-price":
			words = `No BEM price right now. ${p.reason}`;
			break;
		case "not-valued":
			words = "Not valued, so no payback";
			break;
	}
	return (
		<div className={s.ask}>
			{asking}
			<div className={s.pb}>
				<span>Payback at this price</span>
				<b>{words}</b>
			</div>
		</div>
	);
}

/** Days are whole days from the read; null is "not by the 2030 halving". low ≥ base ≥ high. */
function paybackDays(days: {
	low: bigint | null;
	base: bigint | null;
	high: bigint | null;
}) {
	const { low, base, high } = days;
	if (high === null) return "Not by the 2030 halving, in any case";
	const slowest = low ?? base;
	if (slowest === null)
		return `${formatCount(high)} days at best; not by the 2030 halving otherwise`;
	const span =
		slowest === high
			? `${formatCount(high)} days`
			: `${formatCount(high)}–${formatCount(slowest)} days`;
	return low === null
		? `${span}; not by the 2030 halving in the low case`
		: span;
}

function Inputs({ v, page }: { v: Valuation; page: CircuitPage }) {
	const w = v.inputs.minerWeight;
	const g = v.inputs.growthPpm;
	const price = page.bemPrice;
	return (
		<section className={s.inputs} aria-label="What it’s based on">
			<div className={s.sec}>
				<h2>What it’s based on</h2>
				<div className={s.key}>
					<span>
						<i className={s.d} />
						From chain
					</span>
					<span>
						<i className={`${s.d} ${s.a}`} />
						Assumption
					</span>
				</div>
			</div>
			<ul>
				<Input source={w.base} label="Miner weight">
					{formatCount(w.base.value)}
					<small>
						{w.low.value < w.base.value
							? `${formatCount(w.low.value)} without the design bonus`
							: "no design bonus"}
					</small>
				</Input>
				<Input source={v.inputs.networkWeight} label="Network weight">
					{formatCount(v.inputs.networkWeight.value)}
					<small>
						{formatShare(w.base.value, v.inputs.networkWeight.value)}% is this
						miner
					</small>
				</Input>
				<Input
					source={v.inputs.emissionRate}
					label="Emission to verified miners"
				>
					{formatBemPerDay(v.inputs.emissionRate.value, VERIFIED_SHARE)} BEM a
					day
					<small>
						{VERIFIED_SHARE.toString()}% of{" "}
						{formatBemPerDay(v.inputs.emissionRate.value)}
					</small>
				</Input>
				<Input source={g.base} label="Network growth, low · base · high">
					<span title={`Low: ${basis(g.low)}. High: ${basis(g.high)}.`}>
						{formatPpmPercent(g.low.value)} · {formatPpmPercent(g.base.value)} ·{" "}
						{formatPpmPercent(g.high.value)}% a day
					</span>
					<small>{basis(g.base)}</small>
				</Input>
				{"bnbPerBem" in price && (
					<li>
						<i className={s.d} />
						<span>BEM price</span>
						<b
							title={`The pool held ${formatAmount({ currency: "BEM", value: price.poolBem })} and ${formatAmount({ currency: "BNB", value: price.poolWbnb }).replace("BNB", "WBNB")} at BNB block ${formatCount(price.readAt.block)}`}
						>
							{formatAmount({ currency: "BNB", value: price.bnbPerBem })}
							<small>PancakeSwap BEM/WBNB, 30-minute average</small>
						</b>
					</li>
				)}
				<li>
					<i className={`${s.d} ${s.a}`} />
					<span>Block · model</span>
					<b>
						{w.base.source === "chain" ? formatCount(w.base.block) : "Not read"}
						<small>model {v.model.version}</small>
					</b>
				</li>
			</ul>
			<p className={s.legal}>
				Estimated values under stated assumptions. Not financial advice.
			</p>
		</section>
	);
}

function Input({
	source,
	label,
	children,
}: {
	source: Sourced<bigint>;
	label: string;
	children: ReactNode;
}) {
	// A constant from the sealed mining contract's verified source counts as from chain
	return (
		<li>
			<i className={source.source === "assumption" ? `${s.d} ${s.a}` : s.d} />
			<span>{label}</span>
			<b>{children}</b>
		</li>
	);
}

function basis(x: Sourced<bigint>): string {
	return x.source === "assumption"
		? x.basis
		: x.source === "constant"
			? x.ref
			: `BNB block ${formatCount(x.block)}`;
}
