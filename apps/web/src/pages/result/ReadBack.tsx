// "Read it back from the contract" (docs/decisions/2026-11-23-read-back.md; read-back A in
// docs/mocks/2026-11-23-readback-and-loading.html): the browser reads ForemanResults on X Layer itself,
// hashes the logged result, compares it with what the contract stores and with this page, and lists each
// check in plain words; a published verdict that still holds is said so (2026-11-23-same-verdict-read-back.md).
// Foreman's API isn't in the path. Read only.

import {
	type PublishedReadBack,
	RESULTS_CONTRACTS,
	ReadBackError,
	readPublishedResult,
	XLAYER_RPC,
} from "@foreman/chain-xlayer/results";
import type { CircuitPage, Originality } from "@foreman/contract";
import { useState } from "react";
import { BaseError, createPublicClient, http, type PublicClient } from "viem";
import { xLayer, xLayerTestnet } from "viem/chains";
import { formatCount, shortHex } from "../../format.ts";
import { CAN_MINE } from "./circuit-words.ts";
import s from "./ReadBack.module.css";
import { compareWithPage, verdictWords } from "./read-back-compare.ts";

type Published = Exclude<CircuitPage["published"], { state: "not-published" }>;

const NETWORK = { 196: "X Layer", 1952: "X Layer testnet" } as const;
const CHAIN = { 196: xLayer, 1952: xLayerTestnet } as const;

type State =
	| { at: "idle" }
	| { at: "reading" }
	| { at: "read"; read: PublishedReadBack }
	| { at: "failed"; detail: string };

export function ReadBack({ page, p }: { page: CircuitPage; p: Published }) {
	const [state, setState] = useState<State>({ at: "idle" });
	const chainId = p.publishedAt.chainId;

	async function read() {
		setState({ at: "reading" });
		const listed = RESULTS_CONTRACTS[chainId];
		if (!listed || listed !== p.contract.toLowerCase()) {
			setState({
				at: "failed",
				detail: `This result names a contract Foreman doesn’t list for ${NETWORK[chainId]}, so it isn’t read.`,
			});
			return;
		}
		try {
			const client = createPublicClient({
				chain: CHAIN[chainId],
				transport: http(XLAYER_RPC[chainId]),
			}) as PublicClient;
			const result = await readPublishedResult(client, {
				chainId,
				contract: listed,
				processor: page.circuit.processor,
				circuitId: page.circuit.tokenId,
				tx: p.publishedAt.tx,
			});
			setState({ at: "read", read: result });
		} catch (error) {
			setState({
				at: "failed",
				detail:
					error instanceof ReadBackError
						? error.message
						: `Couldn’t read ${NETWORK[chainId]}: ${error instanceof BaseError ? error.shortMessage : "the request failed"}. Try again.`,
			});
		}
	}

	return (
		<>
			{state.at === "read" && <Checks page={page} p={p} read={state.read} />}
			{state.at === "failed" && (
				<p className={s.problem} role="alert">
					{state.detail}
				</p>
			)}
			<button
				type="button"
				className={s.button}
				onClick={read}
				disabled={state.at === "reading"}
			>
				{state.at === "reading" ? (
					<>
						<span className={s.spin} aria-hidden="true" />
						Reading {NETWORK[chainId]}…
					</>
				) : state.at === "idle" ? (
					"Read it back from the contract"
				) : (
					"Read it again"
				)}
			</button>
		</>
	);
}

function Checks({
	page,
	p,
	read: r,
}: {
	page: CircuitPage;
	p: Published;
	read: PublishedReadBack;
}) {
	const net = NETWORK[r.readAt.chainId];
	const onPage = page.check.state === "checked" ? page.check.originality : null;
	const compared = compareWithPage(r.logged, onPage);
	return (
		<div aria-live="polite">
			<ul className={s.checks}>
				<Check ok title="Found the publish">
					Transaction{" "}
					<span className={s.mono}>{shortHex(r.publishedAt.tx)}</span>, {net}{" "}
					block {formatCount(r.publishedAt.block)}
				</Check>
				{r.stored === null ? (
					<Check
						ok={false}
						title="The contract stores nothing for this circuit"
					>
						Its storage holds no result for circuit #
						{page.circuit.tokenId.toString()}.
					</Check>
				) : !r.current ? (
					<Check ok={false} title="The contract stores a later result">
						Its stored hash{" "}
						<span className={s.mono}>{shortHex(r.stored.resultHash)}</span>{" "}
						isn’t this publish’s{" "}
						<span className={s.mono}>{shortHex(r.loggedHash)}</span>.
					</Check>
				) : !r.shortVerdictAgrees ? (
					<Check ok={false} title="The logged short verdict doesn’t match">
						The log’s short verdict or block differs from the logged result.
					</Check>
				) : (
					<Check ok title="The contract stores this result">
						Hash <span className={s.mono}>{shortHex(r.loggedHash)}</span> of the
						logged result is the one in storage
					</Check>
				)}
				{compared === "identical" ? (
					<Check ok title="Same as this page">
						Verdict, evidence, rule ({r.logged.ruleVersion}) and BNB block{" "}
						{formatCount(r.logged.index.upToBlock.block)}
					</Check>
				) : compared === "same-verdict" && onPage ? (
					// Mock B of docs/mocks/2026-11-23-readback-same-verdict.html: the tick covers only what
					// was compared; the newer check is a neutral fact beside it
					<>
						<Check ok title="Same verdict and evidence as this page">
							{sameVerdictDetail(r.logged)}
						</Check>
						<Check mark="neutral" title="Checked again since">
							Published from BNB block{" "}
							{formatCount(r.logged.index.upToBlock.block)} against{" "}
							{formatCount(r.logged.index.circuitsChecked)} circuits; this page
							is at {formatCount(onPage.index.upToBlock.block)} against{" "}
							{formatCount(onPage.index.circuitsChecked)}. A newer check with
							the same verdict isn’t published again.
						</Check>
					</>
				) : (
					<Check ok={false} title="The verdict changed since">
						{onPage
							? `Published: ${verdictWords(r.logged)}. This page: ${verdictWords(onPage)}${p.state === "older" ? ". The worker publishes the new verdict within 5 minutes." : "."}`
							: `Published: ${verdictWords(r.logged)}. This page has no result to compare.`}
					</Check>
				)}
			</ul>
			<p className={s.src}>
				Read from {net} at block {formatCount(r.readAt.block)}, straight from
				the chain, not through Foreman.
			</p>
		</div>
	);
}

/** What the tick covers: the verdict, its evidence and the can-mine state, in the product's words. */
function sameVerdictDetail(o: Originality): string {
	const r = o.result;
	const hash =
		"netlistHash" in r ? `, netlist hash ${shortHex(r.netlistHash)}` : "";
	const canMine = o.facts.find((f) => f.fact === "can-mine");
	const mine = canMine ? `, ${CAN_MINE[canMine.state].toLowerCase()}` : "";
	return `${verdictWords(o)}${hash}${mine}`;
}

function Check({
	ok = false,
	mark,
	title,
	children,
}: {
	ok?: boolean;
	/** A fact beside the checks: neither tick nor cross. */
	mark?: "neutral";
	title: string;
	children: React.ReactNode;
}) {
	return (
		<li>
			{mark === "neutral" ? (
				<svg
					className={s.mid}
					width="18"
					height="18"
					viewBox="0 0 18 18"
					aria-hidden="true"
				>
					<circle cx="9" cy="9" r="3" fill="currentColor" />
				</svg>
			) : ok ? (
				<svg
					className={s.ok}
					width="18"
					height="18"
					viewBox="0 0 18 18"
					aria-label="Yes"
				>
					<path
						d="M4 9.5l3.2 3L14 6"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) : (
				<svg
					className={s.no}
					width="18"
					height="18"
					viewBox="0 0 18 18"
					aria-label="No"
				>
					<path
						d="M5 5l8 8M13 5l-8 8"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
					/>
				</svg>
			)}
			<span>
				<b>{title}</b>
				<small>{children}</small>
			</span>
		</li>
	);
}
