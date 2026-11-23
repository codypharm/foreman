// Your miners (docs/mocks/2026-11-23-copy-alerts-by-design.html, chosen 23 Nov 2026): the connected
// wallet's miners, one copy alert per design, and every miner with its verdict, from
// GET /wallet/:address/miners. Facts, never accusations; nothing here decides a verdict.

import type {
	CopyListing,
	OriginalityFact,
	StoredCheck,
	WalletMiner,
	WalletMiners,
} from "@foreman/contract";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { useConnection } from "wagmi";
import { Link } from "wouter";
import { ApiProblem, fetchWallet } from "../../api.ts";
import { LoadingNote, RowShapes, Shape } from "../../components/Shape.tsx";
import { VerdictLine } from "../../components/VerdictLine.tsx";
import { WalletButton } from "../../components/WalletButton.tsx";
import { formatAsk, formatCount, formatDate, shortHex } from "../../format.ts";
import {
	CAN_MINE,
	circuitName,
	designTime,
	processorLabel,
} from "../result/circuit-words.ts";
import { type AlertGroup, groupAlerts } from "./alert-groups.ts";
import s from "./WalletPage.module.css";

const LIMIT =
	"Checks identical netlists, including swapped gate inputs. A copy with its gates reordered isn’t detected.";
const FIRST_COPIES = 3;
const FIRST_MINERS = 10;

export function WalletPage() {
	const { address, status } = useConnection();

	useEffect(() => {
		document.title = "Foreman · Your miners";
		return () => {
			document.title = "Foreman · Live listings";
		};
	}, []);

	if (!address) {
		const looking = status === "reconnecting" || status === "connecting";
		return (
			<div className={s.page}>
				<main>
					<section className={s.intro}>
						<h1>Your miners</h1>
						{looking ? (
							<p>Looking for your wallet…</p>
						) : (
							<>
								<p>
									Connect a wallet to see the miners it holds, and whether a
									copy of any of them is listed on TapeOut’s market.
								</p>
								<div className={s.connect}>
									<WalletButton big />
								</div>
							</>
						)}
					</section>
				</main>
				<Watch />
			</div>
		);
	}
	return <Miners key={address} address={address.toLowerCase()} />;
}

function Miners({ address }: { address: string }) {
	const page = useQuery({
		queryKey: ["wallet", address],
		queryFn: () => fetchWallet(address),
	});

	if (!page.data) {
		return (
			<div className={s.page}>
				<main>
					<section className={s.intro}>
						<h1>Your miners</h1>
						<p>{shortHex(address)}</p>
					</section>
					{page.isError ? (
						<div className={s.problem} role="alert">
							{page.error instanceof ApiProblem
								? page.error.problem.detail
								: "Something went wrong reading this wallet’s miners."}
							<br />
							<button type="button" onClick={() => page.refetch()}>
								Try again
							</button>
						</div>
					) : (
						<div aria-busy="true">
							<LoadingNote>
								Reading your miners from BNB Chain and your RIG vouchers from X
								Layer.
							</LoadingNote>
							<Shape h={168} r={18} mt={20} />
							<Shape w={140} h={18} mt={40} />
							<RowShapes count={5} />
						</div>
					)}
				</main>
				<Watch />
			</div>
		);
	}

	const w = page.data;
	const groups = groupAlerts(w.miners);
	const n = w.miners.length;
	return (
		<div className={s.page}>
			<main>
				<section className={s.intro}>
					<h1>Your miners</h1>
					<p>
						{formatCount(n)} miner{n === 1 ? "" : "s"} held by{" "}
						{shortHex(w.wallet)}, watched for copies
					</p>
				</section>

				{n === 0 ? (
					<p className={s.fact}>
						No miners held by this wallet, up to BNB block{" "}
						{formatCount(w.owners.upToBlock)}. A miner held for a RIG voucher
						counts when the voucher is in this wallet on X Layer.
					</p>
				) : groups.length === 0 ? (
					<p className={s.fact}>
						No copy of your miners is listed on TapeOut’s market, up to BNB
						block {formatCount(w.market.upTo.block)}.
					</p>
				) : (
					groups.map((g, i) => (
						<Alert
							key={g.netlistHash}
							group={g}
							block={i === 0 ? w.market.upTo.block : null}
							refTime={w.market.upTo.time}
						/>
					))
				)}

				{n > 0 && <MinerList wallet={w} groups={groups} />}
			</main>
			<Watch wallet={w} groups={groups} />
		</div>
	);
}

/** One design's alert: in full when a copy was listed this week, otherwise short. */
function Alert({
	group: g,
	block,
	refTime,
}: {
	group: AlertGroup;
	block: bigint | null;
	refTime: bigint;
}) {
	const [open, setOpen] = useState(false);
	const full = g.justListed > 0;
	const one = g.miners.length === 1;
	const only = g.miners[0] as WalletMiner;
	const day = (t: bigint) => shortDate(t, refTime);
	const newest = g.copies[0]?.listing.listedAt.time ?? 0n;

	if (!full) {
		return (
			<article className={s.alert}>
				<h3>
					{g.circuits === 1
						? `A copy of ${one ? `your miner ${circuitName(only.circuit)}` : `${g.miners.length} of your miners`} is listed`
						: `${formatCount(g.circuits)} copies of ${one ? `your miner ${circuitName(only.circuit)}` : `${g.miners.length} of your miners`} are listed`}
				</h3>
				<p className={s.own}>
					<Own group={g} /> Newest listed {day(newest)}.
				</p>
				{open && <Copies copies={g.copies} refTime={refTime} />}
				<button
					type="button"
					className={s.more}
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
				>
					{open
						? "Hide the listings"
						: g.copies.length === 1
							? "Show the listing"
							: `Show the ${formatCount(g.copies.length)} listings`}
				</button>
			</article>
		);
	}

	const just = g.copies.filter((c) => c.justListed);
	const since = day(
		just.reduce(
			(t, c) => (c.listing.listedAt.time < t ? c.listing.listedAt.time : t),
			newest,
		),
	);
	const mine = one
		? `your ${circuitName(only.circuit)}`
		: `${g.miners.length} of your miners`;
	const earliest = designTime(g.earliest.circuit);
	const shown = open ? g.copies : g.copies.slice(0, FIRST_COPIES);
	return (
		<article className={s.alert}>
			<div className={s.when}>
				<i aria-hidden="true" />
				{formatCount(g.justListed)} listed this week
				{block !== null && ` · BNB block ${formatCount(block)}`}
			</div>
			<h3>A copy of your miner was just listed</h3>
			<p className={s.lead}>
				<b>
					{formatCount(g.circuits)} circuit{g.circuits === 1 ? "" : "s"}{" "}
					identical to {mine}
				</b>{" "}
				{g.circuits === 1 ? "is" : "are"} listed on TapeOut’s market
				{g.copies.length === 1
					? `, listed ${since}`
					: just.length === g.copies.length
						? `, all of them since ${since}`
						: `, ${formatCount(just.length)} of them since ${since}`}
				.
			</p>
			<p className={s.own}>
				<Own group={g} />
			</p>
			<Copies copies={shown} refTime={refTime} />
			{g.copies.length > FIRST_COPIES && (
				<button
					type="button"
					className={s.more}
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
				>
					{open
						? "Show the newest 3"
						: `Show all ${formatCount(g.copies.length)} listings`}
				</button>
			)}
			<p className={s.rule}>
				<b>The earliest proven design is the original.</b>{" "}
				{one ? "Your " : "Your earliest here, "}
				{circuitName(g.earliest.circuit)}
				{one ? "" : ","} was{" "}
				{earliest.by === "commitment" ? "designed" : "taped out"}{" "}
				{formatDate(earliest.time)}. Netlist hash{" "}
				<span className={s.mono}>{shortHex(g.netlistHash)}</span>.
			</p>
		</article>
	);
}

/** Whether the wallet's own miners on this design are themselves identical to an earlier circuit. */
function Own({ group: g }: { group: AlertGroup }): ReactNode {
	const check = g.earliest.check;
	if (check.state !== "checked") return null;
	const r = check.originality.result;
	const first = g.miners[0] as WalletMiner;
	const others = g.miners.length - 1;
	if (r.verdict === "copy") {
		const how = designTime(r.of).by === "commitment" ? "designed" : "taped out";
		return others === 0 ? (
			<>
				Your <b>{circuitName(first.circuit)}</b> is itself identical to{" "}
				<b>circuit {circuitName(r.of)}</b>, {how} earlier.
			</>
		) : (
			<>
				Your miners on this design, <b>{circuitName(first.circuit)}</b> and{" "}
				{formatCount(others)} more, are themselves identical to{" "}
				<b>circuit {circuitName(r.of)}</b>, {how} earlier.
			</>
		);
	}
	if (r.verdict === "no-earlier-copy") {
		return others === 0 ? (
			<>No earlier copy of {circuitName(first.circuit)} found.</>
		) : (
			<>
				No earlier copy of your <b>{circuitName(g.earliest.circuit)}</b> found;
				your other {formatCount(others)} on this design are identical to it.
			</>
		);
	}
	return null;
}

function Copies({
	copies,
	refTime,
}: {
	copies: CopyListing[];
	refTime: bigint;
}) {
	return (
		<ul className={s.copies}>
			{copies.map((c) => {
				const t = designTime(c.circuit);
				return (
					<li key={c.listing.listingId.toString()}>
						<Link href={`/circuit/${c.circuit.processor}/${c.circuit.tokenId}`}>
							<span>
								{circuitName(c.circuit)} · {processorLabel(c.circuit.processor)}
								<small>
									{t.by === "commitment" ? "designed" : "taped out"}{" "}
									{formatDate(t.time)}
									{c.sameAddress && " · taped out by the same address"}
								</small>
							</span>
							<b>
								{formatAsk(c.listing.ask)}
								<small>
									{c.justListed ? (
										<>
											<span className={s.new}>Just listed</span> ·{" "}
											{shortDate(c.listing.listedAt.time, refTime)}
										</>
									) : (
										`listed ${shortDate(c.listing.listedAt.time, refTime)}`
									)}
									{!c.listing.buyable && " · can’t be bought right now"}
								</small>
							</b>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

function MinerList({
	wallet: w,
	groups,
}: {
	wallet: WalletMiners;
	groups: AlertGroup[];
}) {
	const [all, setAll] = useState(false);
	const byHash = new Map(groups.map((g) => [g.netlistHash, g]));
	const shown = all ? w.miners : w.miners.slice(0, FIRST_MINERS);
	return (
		<section className={s.mine}>
			<div className={s.sec}>
				<h2>
					All {formatCount(w.miners.length)} miner
					{w.miners.length === 1 ? "" : "s"}
				</h2>
				{groups.length > 0 && (
					<span className={s.meta}>Copies listed first</span>
				)}
			</div>
			<ul className={s.rows}>
				{shown.map((m) => (
					<MinerRow
						key={m.minerKey}
						miner={m}
						group={m.alert ? byHash.get(m.alert.netlistHash) : undefined}
					/>
				))}
			</ul>
			{w.miners.length > FIRST_MINERS && (
				<button
					type="button"
					className={s.showall}
					onClick={() => setAll((a) => !a)}
					aria-expanded={all}
				>
					{all
						? `Show the first ${FIRST_MINERS}`
						: `Show all ${formatCount(w.miners.length)}`}
				</button>
			)}
			<p className={s.limit}>
				{indexLine(w.miners.map((m) => m.check))} {LIMIT}
			</p>
		</section>
	);
}

function MinerRow({
	miner: m,
	group,
}: {
	miner: WalletMiner;
	group: AlertGroup | undefined;
}) {
	const facts = m.check.state === "checked" ? m.check.originality.facts : [];
	const canMine = fact(facts, "can-mine");
	const bonus = fact(facts, "design-bonus");
	const shared = fact(facts, "design-shared")?.miners ?? 1;
	const identical = shared - 1;
	return (
		<li>
			<Link href={`/circuit/${m.circuit.processor}/${m.circuit.tokenId}`}>
				<span
					className={m.multiplier === 6 ? s.badge : `${s.badge} ${s.g}`}
					aria-hidden="true"
				>
					×{m.multiplier}
				</span>
				<span className={s.k}>
					Circuit {circuitName(m.circuit)}
					{group && (
						<span className={group.justListed > 0 ? s.flag : s.quiet}>
							{formatCount(group.circuits)}{" "}
							{group.circuits === 1 ? "copy" : "copies"} listed
						</span>
					)}
					<small>
						<VerdictLine check={m.check} />
						{bonus &&
							(bonus.holds
								? " · holds the design bonus"
								: " · no design bonus")}
						{m.heldAs.kind === "voucher" &&
							` · RIG voucher #${m.heldAs.voucherId}`}
					</small>
				</span>
				<span className={s.v}>
					{canMine ? CAN_MINE[canMine.state] : "Can’t check"}
					<small>
						{identical === 0
							? "No identical miners"
							: `${formatCount(identical)} identical miner${identical === 1 ? "" : "s"}`}
					</small>
				</span>
			</Link>
		</li>
	);
}

/** The copy alerts aside: what is watched and up to which blocks. */
function Watch({
	wallet: w,
	groups,
}: {
	wallet?: WalletMiners;
	groups?: AlertGroup[];
}) {
	const rule = w?.miners.find((m) => m.alert)?.alert?.rule;
	const thisWeek = groups?.filter((g) => g.justListed > 0).length ?? 0;
	return (
		<aside className={s.watch} aria-label="Copy alerts">
			<div className={s.sec}>
				<h2>Copy alerts</h2>
			</div>
			{w && groups && (
				<dl>
					<dt>Watching</dt>
					<dd>
						{formatCount(w.miners.length)} miner
						{w.miners.length === 1 ? "" : "s"}
					</dd>
					<dt>Owners read to</dt>
					<dd>BNB block {formatCount(w.owners.upToBlock)}</dd>
					<dt>Market read to</dt>
					<dd>BNB block {formatCount(w.market.upTo.block)}</dd>
					{w.miners.some((m) => m.heldAs.kind === "voucher") && (
						<>
							<dt>RIG vouchers read at</dt>
							<dd>X Layer block {formatCount(w.vouchers.block)}</dd>
						</>
					)}
					<dt>Listed this week</dt>
					<dd>
						{thisWeek === 0
							? "None"
							: `${thisWeek} design${thisWeek === 1 ? "" : "s"}`}
					</dd>
				</dl>
			)}
			<p>
				An alert appears when a circuit identical to one of your miners, with a
				later design time, is listed on TapeOut’s market. Miners with the same
				netlist share one alert. Alerts show here while your wallet is
				connected. Foreman never holds or moves your miners.
			</p>
			{rule && <p className={s.rulename}>Rule: {rule}.</p>}
		</aside>
	);
}

/** "Each verdict checked against 80,348 circuits up to BNB block 135,135,809." */
function indexLine(checks: StoredCheck[]): string {
	const idx = checks.flatMap((c) =>
		c.state === "checked" ? [c.originality.index] : [],
	);
	const first = idx[0];
	if (!first) return "";
	const same = idx.every(
		(i) =>
			i.circuitsChecked === first.circuitsChecked &&
			i.upToBlock.block === first.upToBlock.block,
	);
	if (same) {
		return `Each verdict checked against ${formatCount(first.circuitsChecked)} circuits up to BNB block ${formatCount(first.upToBlock.block)}.`;
	}
	const blocks = idx.map((i) => i.upToBlock.block);
	const lo = blocks.reduce((a, b) => (b < a ? b : a));
	const hi = blocks.reduce((a, b) => (b > a ? b : a));
	return `Verdicts checked up to BNB blocks ${formatCount(lo)} to ${formatCount(hi)}; each circuit’s page gives its count.`;
}

/** "20 Nov", with the year when it isn't the market read's year. */
function shortDate(unix: bigint, ref: bigint): string {
	const d = formatDate(unix);
	const year = new Date(Number(ref) * 1000).getUTCFullYear().toString();
	return d.endsWith(` ${year}`) ? d.slice(0, -year.length - 1) : d;
}

function fact<K extends OriginalityFact["fact"]>(
	facts: OriginalityFact[],
	kind: K,
): Extract<OriginalityFact, { fact: K }> | undefined {
	return facts.find(
		(f): f is Extract<OriginalityFact, { fact: K }> => f.fact === kind,
	);
}
