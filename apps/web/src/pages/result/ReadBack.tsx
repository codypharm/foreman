// "Read it back from the contract" (docs/decisions/2026-11-23-read-back.md; read-back A in
// docs/mocks/2026-11-23-readback-and-loading.html): the browser reads ForemanResults on X Layer itself,
// hashes the logged result, compares it with what the contract stores and with this page, and lists each
// check in plain words. Foreman's API isn't in the path. Read only.

import {
	type PublishedReadBack,
	RESULTS_CONTRACTS,
	ReadBackError,
	readPublishedResult,
	XLAYER_RPC,
} from "@foreman/chain-xlayer/results";
import {
	type CircuitPage,
	type Originality,
	serialiseOriginality,
} from "@foreman/contract";
import { useState } from "react";
import { BaseError, createPublicClient, http, type PublicClient } from "viem";
import { xLayer, xLayerTestnet } from "viem/chains";
import { formatCount, shortHex } from "../../format.ts";
import s from "./ReadBack.module.css";

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
	const same = onPage !== null && wire(onPage) === wire(r.logged);
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
				{same ? (
					<Check ok title="Same as this page">
						Verdict, evidence, rule ({r.logged.ruleVersion}) and BNB block{" "}
						{formatCount(r.logged.index.upToBlock.block)}
					</Check>
				) : (
					<Check ok={false} title="Differs from this page">
						{p.state === "older"
							? "This page shows a newer check that isn’t published yet."
							: `The published result was read at BNB block ${formatCount(r.logged.index.upToBlock.block)}; this page shows a different one.`}
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

function Check({
	ok,
	title,
	children,
}: {
	ok: boolean;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<li>
			{ok ? (
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

/** The data contract's wire form, so two results compare field for field. */
const wire = (o: Originality) =>
	JSON.stringify(serialiseOriginality(o, "originality"));
