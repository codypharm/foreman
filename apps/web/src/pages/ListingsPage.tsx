// Today's listings, checked: every open listing on TapeOut's BNB circuit market with its verdict and
// its 30-day estimated value as a range (docs/mocks/2026-11-21-live-listings.html, rows from
// 2026-11-22-listings-row-range.html). Everything shown comes from GET /listings; nothing is computed
// here but formatting.

import {
	LISTING_VERDICTS,
	LISTINGS_PAGE_SIZE,
	type ListingRow,
	type ListingVerdict,
	type ListingsPage as Page,
} from "@foreman/contract";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "wouter";
import { fetchListings } from "../api.ts";
import { ReadProblem } from "../components/ReadProblem.tsx";
import { LoadingNote, RowShapes, Shape } from "../components/Shape.tsx";
import { VerdictLine } from "../components/VerdictLine.tsx";
import { formatAsk, formatBemRange, formatCount } from "../format.ts";
import s from "./ListingsPage.module.css";

/** The verdict filters, in the order the screen shows them. */
const FILTERS: { verdict: ListingVerdict; label: string }[] = [
	{ verdict: "copy", label: "Copy" },
	{ verdict: "wrapper", label: "Wrapper" },
	{ verdict: "no-earlier-copy", label: "No earlier copy found" },
	{ verdict: "too-small-to-tell", label: "Too small to tell" },
	{ verdict: "cant-check", label: "Can’t check" },
	{ verdict: "not-checked", label: "Can’t check yet" },
];
const LABEL = Object.fromEntries(
	FILTERS.map((f) => [f.verdict, f.label]),
) as Record<ListingVerdict, string>;

const SET_NOUN: Record<Page["set"], string> = {
	mining: "mining miners for sale",
	all: "open listings",
};

export function ListingsPage() {
	const [params] = useSearchParams();
	const [location, navigate] = useLocation();
	const set: Page["set"] = params.get("set") === "all" ? "all" : "mining";
	const asked = params.get("verdict");
	const verdict = (LISTING_VERDICTS as readonly string[]).includes(asked ?? "")
		? (asked as ListingVerdict)
		: null;

	const listings = useInfiniteQuery({
		queryKey: ["listings", set, verdict],
		queryFn: ({ pageParam }) =>
			fetchListings({ set, verdict, cursor: pageParam }),
		initialPageParam: null as string | null,
		getNextPageParam: (last) => last.next,
	});
	// "All listings, by verdict" counts every open listing, whichever set is shown
	const everyListing = useQuery({
		queryKey: ["listings-summary", "all"],
		queryFn: () => fetchListings({ set: "all", verdict: null, cursor: null }),
	});

	const choose = (next: {
		set?: Page["set"];
		verdict?: ListingVerdict | null;
	}) => {
		const nextSet = next.set ?? set;
		const nextVerdict = next.verdict === undefined ? verdict : next.verdict;
		const p = new URLSearchParams();
		if (nextSet !== "mining") p.set("set", nextSet);
		if (nextVerdict) p.set("verdict", nextVerdict);
		// Always with "?": wouter's setSearchParams drops it for an empty query, and its hash navigate
		// then leaves the old query in place, so the default set could never be chosen again
		navigate(`${location}?${p}`);
	};

	const first = listings.data?.pages[0];
	const rows = listings.data?.pages.flatMap((p) => p.rows) ?? [];

	return (
		<div className={s.page}>
			<main>
				<section className={s.intro}>
					<h1>Today’s listings, checked</h1>
					<p>
						Every open listing on TapeOut’s circuit market
						{first && `, BNB block ${formatCount(first.market.upTo.block)}`}
					</p>
				</section>

				{listings.isPending && (
					<div aria-busy="true">
						<LoadingNote>
							Reading today’s listings from TapeOut’s circuit market.
						</LoadingNote>
						<Shape w={300} h={40} r={999} mt={24} />
						<Shape w={260} h={30} r={999} mt={14} />
						<RowShapes count={8} />
					</div>
				)}
				{listings.isError && (
					<ReadProblem
						className={s.problem}
						error={listings.error}
						fallback="Something went wrong reading the listings."
						retry={() => listings.refetch()}
					/>
				)}

				{first && (
					<>
						<div className={s.seg} role="tablist" aria-label="Which listings">
							<button
								type="button"
								role="tab"
								aria-selected={set === "mining"}
								onClick={() => choose({ set: "mining", verdict: null })}
							>
								Mining miners · {formatCount(first.counts.bySet.mining)}
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={set === "all"}
								onClick={() => choose({ set: "all", verdict: null })}
							>
								All listings · {formatCount(first.counts.bySet.all)}
							</button>
						</div>
						<div className={s.filters}>
							<button
								type="button"
								aria-pressed={verdict === null}
								onClick={() => choose({ verdict: null })}
							>
								All<b>{formatCount(first.counts.bySet[set])}</b>
							</button>
							{FILTERS.filter(
								(f) =>
									first.counts.byVerdict[f.verdict] > 0 ||
									f.verdict === verdict,
							).map((f) => (
								<button
									key={f.verdict}
									type="button"
									aria-pressed={verdict === f.verdict}
									onClick={() => choose({ verdict: f.verdict })}
								>
									{f.label}
									<b>{formatCount(first.counts.byVerdict[f.verdict])}</b>
								</button>
							))}
						</div>
						<CopyFact page={first} />

						{rows.length === 0 ? (
							<p className={s.empty}>
								No {verdict ? `“${LABEL[verdict]}” ` : ""}listings among the{" "}
								{SET_NOUN[set]} right now.
							</p>
						) : (
							<ul className={s.rows}>
								{rows.map((r) => (
									<Row key={r.listing.listingId.toString()} row={r} />
								))}
							</ul>
						)}
						{listings.hasNextPage && (
							<button
								type="button"
								className={s.more}
								disabled={listings.isFetchingNextPage}
								onClick={() => listings.fetchNextPage()}
							>
								{listings.isFetchingNextPage
									? "Reading more…"
									: `Show ${formatCount(Math.min(LISTINGS_PAGE_SIZE, (verdict ? first.counts.byVerdict[verdict] : first.counts.bySet[set]) - rows.length))} more`}
							</button>
						)}
						{listings.isFetchNextPageError && (
							<ReadProblem
								className={s.problem}
								error={listings.error}
								fallback="Something went wrong reading the listings."
								retry={() => listings.fetchNextPage()}
							/>
						)}

						<p className={s.limit}>
							Each verdict checked against{" "}
							{formatCount(first.index.circuitsChecked)} circuits up to BNB
							block {formatCount(first.index.upToBlock.block)}. The earliest
							proven design is the original. Checks identical netlists,
							including swapped gate inputs. A copy with its gates reordered
							isn’t detected. Values are estimated ranges under stated
							assumptions, not financial advice.
						</p>
					</>
				)}
			</main>

			{first && <MarketToday page={first} every={everyListing.data} />}
		</div>
	);
}

/** "86 of the 300 mining miners for sale are copies of an earlier circuit." */
function CopyFact({ page }: { page: Page }) {
	const copies = page.counts.byVerdict.copy;
	const total = page.counts.bySet[page.set];
	const noun = SET_NOUN[page.set];
	if (copies === 0) {
		return (
			<p className={s.fact}>
				None of the {formatCount(total)} {noun} is a copy of an earlier circuit.
			</p>
		);
	}
	return (
		<p className={s.fact}>
			<b>
				{formatCount(copies)} of the {formatCount(total)}
			</b>{" "}
			{noun} {copies === 1 ? "is a copy" : "are copies"} of an earlier circuit.
		</p>
	);
}

function Row({ row }: { row: ListingRow }) {
	const { circuit, listing, multiplier, check } = row;
	const badge =
		multiplier === 6
			? s.badge
			: `${s.badge} ${multiplier === 0 ? s.none : s.one}`;
	return (
		<li>
			<Link href={`/circuit/${circuit.processor}/${circuit.tokenId}`}>
				<span className={badge} title={`Weight multiplier ${multiplier}`}>
					×{multiplier}
				</span>
				<span className={s.k}>
					Circuit #{circuit.tokenId.toString()}
					<small>
						<VerdictLine check={check} />
					</small>
				</span>
				<span className={s.v}>
					{formatAsk(listing.ask)}
					<small>
						<Value value={row.value30d} />
					</small>
				</span>
			</Link>
		</li>
	);
}

/** The 30-day estimated value, low to high; a row with no range says why, never a zero. */
function Value({ value }: { value: ListingRow["value30d"] }) {
	switch (value.state) {
		case "shown": {
			const { low, high } = value.valuation.range;
			return <>{formatBemRange(low, high)} BEM / 30 days</>;
		}
		case "not-valued":
			return <span title={value.reason}>Not valued · unverified pool</span>;
		case "not-mining":
			return <>Not mining</>;
		case "not-read":
			return <span title={value.detail}>Not read yet</span>;
	}
}

function MarketToday({ page, every }: { page: Page; every: Page | undefined }) {
	const byVerdict = every
		? FILTERS.map((f) => ({ ...f, n: every.counts.byVerdict[f.verdict] }))
				.filter((f) => f.verdict !== "not-checked" || f.n > 0)
				.sort((a, b) => b.n - a.n)
		: null;
	return (
		<aside className={s.market} aria-label="Market today">
			<div className={s.sec}>
				<h2>Market today</h2>
			</div>
			<dl>
				<dt>Open listings</dt>
				<dd>{formatCount(page.counts.open)}</dd>
				<dt>Buyable now</dt>
				<dd>{formatCount(page.counts.buyable)}</dd>
				<dt>Sellers</dt>
				<dd>{formatCount(page.counts.sellers)}</dd>
				<dt>Mining miners for sale</dt>
				<dd>{formatCount(page.counts.bySet.mining)}</dd>
			</dl>
			<p className={s.sub}>All listings, by verdict</p>
			<dl>
				{byVerdict
					? byVerdict.map((f) => (
							<Fragmentless
								key={f.verdict}
								label={f.label}
								value={formatCount(f.n)}
							/>
						))
					: FILTERS.slice(0, 5).map((f) => (
							<Fragmentless key={f.verdict} label={f.label} value={null} />
						))}
			</dl>
		</aside>
	);
}

/** One term and its value; a value not read yet is shown as such, never as zero. */
function Fragmentless({
	label,
	value,
}: {
	label: string;
	value: string | null;
}) {
	return (
		<>
			<dt>{label}</dt>
			<dd className={value === null ? s.missing : undefined}>
				{value ?? "Reading…"}
			</dd>
		</>
	);
}
