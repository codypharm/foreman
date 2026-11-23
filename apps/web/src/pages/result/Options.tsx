// Options: Hold, Sell, Lend and Rent, each as it really is today (CLAUDE.md, "Missing is missing":
// no bid, no offer and no rental market are said, never shown as zero). Then whether the result was
// published on X Layer.

import type { CircuitPage, LendNoneReason, Offer } from "@foreman/contract";
import { VerdictLine } from "../../components/VerdictLine.tsx";
import {
	formatAmount,
	formatBem,
	formatCount,
	shortHex,
} from "../../format.ts";
import s from "./ResultPage.module.css";

type Lend = Extract<Offer, { option: "lend" }>;

export function Options({ page }: { page: CircuitPage }) {
	return (
		<aside className={s.side} aria-label="Options">
			<div className={s.sec}>
				<h2>Options</h2>
			</div>
			<ul className={s.opts}>
				<Hold hold={page.hold} />
				<Sell sell={page.options.sell} />
				<LendOption lend={page.options.lend} />
				<li>
					<div className={s.h}>
						<strong>Rent</strong>
						<em className={s.none}>
							{page.options.rent.state === "no-venue"
								? "No rental market yet"
								: "No rental offer right now"}
						</em>
					</div>
				</li>
			</ul>
			<Published page={page} />
		</aside>
	);
}

function Hold({ hold }: { hold: CircuitPage["hold"] }) {
	if (hold.state !== "shown") {
		return (
			<li>
				<div className={s.h}>
					<strong>Hold</strong>
					<em className={s.none}>
						{hold.state === "not-mining" ? "Not mining" : "Not valued"}
					</em>
				</div>
				{hold.state === "not-valued" && <p>{hold.reason}</p>}
			</li>
		);
	}
	const { low, base, high } = hold.thirtyDays.range;
	return (
		<li>
			<div className={s.h}>
				<strong>Hold</strong>
				<em>{formatBem(base)} BEM</em>
			</div>
			<p>
				Estimated output over 30 days, range {formatBem(low, "down")} to{" "}
				{formatBem(high, "up")}.
			</p>
		</li>
	);
}

function Sell({ sell }: { sell: CircuitPage["options"]["sell"] }) {
	const { bid, sales } = sell;
	const r = sales.range;
	return (
		<li>
			<div className={s.h}>
				<strong>Sell</strong>
				{bid.state === "live" ? (
					<em>Bid {formatAmount(bid.price)}</em>
				) : (
					<em className={s.none}>No bid right now</em>
				)}
			</div>
			{/* The comparables rule is code, stated on screen; its full words are on hover */}
			<p title={sales.rule}>
				{r.state === "shown" &&
					`Comparable sales: middle half of ${formatCount(sales.items.length)} sales in 14 days, scaled to this miner’s weight.`}
				{r.state === "too-few" &&
					`Only ${formatCount(r.count)} comparable sales in 14 days; a range needs ${r.minimum}.`}
				{r.state === "too-few-sales" &&
					`Only ${formatCount(r.sales)} comparable sales in 14 days; a range needs ${r.minimum}.`}
				{r.state === "not-mining" && "Not mining, so no sale is comparable."}
			</p>
			{r.state === "shown" && (
				<div className={s.sales}>
					<span>
						Low<b>{formatAmount(r.low, 3)}</b>
					</span>
					<span>
						Median<b>{formatAmount(r.mid, 3)}</b>
					</span>
					<span>
						High<b>{formatAmount(r.high, 3)}</b>
					</span>
				</div>
			)}
		</li>
	);
}

function LendOption({ lend }: { lend: [Lend, Lend] }) {
	const live = lend.filter(
		(l): l is Extract<Lend, { state: "live" }> => l.state === "live",
	);
	if (live.length === 0) {
		const [week, fortnight] = lend as [
			Extract<Lend, { state: "none" }>,
			Extract<Lend, { state: "none" }>,
		];
		const same =
			JSON.stringify(week.reason, big) ===
			JSON.stringify(fortnight.reason, big);
		return (
			<li>
				<div className={s.h}>
					<strong>Lend</strong>
					<em className={s.none}>No offer</em>
				</div>
				<p>
					{same
						? noLend(week.reason)
						: `7 days: ${noLend(week.reason)} 14 days: ${noLend(fortnight.reason)}`}
				</p>
			</li>
		);
	}
	const first = live[0] as (typeof live)[number];
	return (
		<li>
			<div className={s.h}>
				<strong>Lend</strong>
				<em>Up to {formatAmount(first.receivedNow)}</em>
			</div>
			<p>
				TapePool, against RIG voucher #{first.voucherId.toString()}.{" "}
				{lend
					.map((l) =>
						l.state === "live"
							? `${l.termDays} days: up to ${formatAmount(l.receivedNow)}, fee ${formatAmount(l.fee)}.`
							: `${l.termDays} days: ${noLend(l.reason)}`,
					)
					.join(" ")}{" "}
				Operating fee {formatAmount(first.opsFee)}. Repaid from its output until
				paid.
			</p>
		</li>
	);
}

const big = (_: string, v: unknown) =>
	typeof v === "bigint" ? v.toString() : v;

function noLend(r: LendNoneReason): string {
	switch (r.kind) {
		case "not-a-voucher":
			return "TapePool lends against RIG vouchers on X Layer. This miner isn’t bridged.";
		case "not-deposited":
			return `RIG voucher #${r.voucherId} isn’t deposited with TapePool.`;
		case "shared-account":
			return `RIG voucher #${r.voucherId} shares a TapePool account with ${formatCount(r.vouchers - 1)} other voucher${r.vouchers === 2 ? "" : "s"}, so its quote isn’t this miner’s alone.`;
		case "declined":
			return `TapePool’s quote for RIG voucher #${r.voucherId} gives no advance (${r.tapepool.replaceAll("-", " ")}).`;
	}
}

const NETWORK = { 196: "X Layer", 1952: "X Layer testnet" } as const;

function Published({ page }: { page: CircuitPage }) {
	const p = page.published;
	const check = page.check;
	return (
		<div className={s.pub}>
			<div className={s.sec}>
				<h2>Published</h2>
			</div>
			{p.state === "not-published" ? (
				<p className={s.quiet}>
					{p.reason === "not-yet"
						? "Not published on X Layer yet."
						: "Checked on request. Only miners and listed circuits are published."}
				</p>
			) : (
				<>
					<div className={s.row}>
						<span className={s.net}>{NETWORK[p.publishedAt.chainId]}</span>
						<span className={s.note}>
							{p.state === "current" ? (
								<VerdictLine check={check} />
							) : (
								"From an earlier check; this result isn’t published yet"
							)}
						</span>
					</div>
					<dl>
						<dt>Transaction</dt>
						<dd className={s.mono} title={p.publishedAt.tx}>
							{shortHex(p.publishedAt.tx)}
						</dd>
						<dt>X Layer block</dt>
						<dd>{formatCount(p.publishedAt.block)}</dd>
						{/* What was read and under which rule is known for the stored result only */}
						{p.state === "current" && check.state === "checked" && (
							<>
								<dt>Read at BNB block</dt>
								<dd>{formatCount(check.originality.index.upToBlock.block)}</dd>
								<dt>Rule</dt>
								<dd>{check.originality.ruleVersion}</dd>
							</>
						)}
					</dl>
					<button
						type="button"
						className={s.readback}
						disabled
						title="Reading the result back from X Layer comes with the wallet page"
					>
						Read it back from the contract
					</button>
				</>
			)}
		</div>
	);
}
