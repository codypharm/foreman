// API, at #/api (docs/mocks/2026-11-26-for-markets.html, option C, chosen 26 Nov 2026; called "For markets" until the same day): what Foreman's
// API answers, shown with a real answer, then a key made with a free wallet signature
// (docs/decisions/2026-11-26-self-serve-api-keys.md). The key is shown once and kept only in this
// page's memory: never stored in the browser, never logged. Under it, once the wallet has a key, the pay
// band (docs/mocks/2026-11-27-api-pay-band.html, B with the Ink buttons, chosen 27 Nov 2026;
// docs/decisions/2026-11-26-paid-api-tier.md): 0.01 test OKB for 600 calls a minute for 30 days.

import { apiPaymentCode, FOREMAN_PRO } from "@foreman/chain-xlayer/pro";
import { apiKeyMessage, parseAddress } from "@foreman/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import {
	API_URL,
	ApiProblem,
	createApiKey,
	readApiKeyStatus,
} from "../../api.ts";
import { WalletButton } from "../../components/WalletButton.tsx";
import { formatDate, shortHex } from "../../format.ts";
import { FAUCET_URL, okb, useProPayment } from "../../pay.ts";
import s from "./MarketsPage.module.css";

/** The live answer for circuit #8044 on 26 Nov 2026, from POST /v1/results (README, "API for markets and lenders"). */
const EXAMPLE = {
	processor: "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c",
	tokenId: "8044",
};

export function MarketsPage() {
	useEffect(() => {
		document.title = "Foreman · API";
		return () => {
			document.title = "Foreman · Live listings";
		};
	}, []);

	return (
		<div className={s.page}>
			<h1>Check every circuit before it’s listed</h1>
			<p className={s.lead}>
				For markets, wallets and lenders: up to 100 circuits a call, each with{" "}
				<b>its evidence and the X Layer transaction</b> where it was published.
				Free today.
			</p>

			<div className={s.pair}>
				<div>
					<div className={s.label}>Your server asks</div>
					<pre className={s.code}>
						<span className={s.k}>curl</span> -X POST \{"\n"}
						{"  "}
						{API_URL}/v1/results \{"\n"}
						{"  "}-H{" "}
						<span className={s.k}>"Authorization: Bearer $FOREMAN_KEY"</span> \
						{"\n"}
						{"  "}-H "Content-Type: application/json" \{"\n"}
						{"  "}-d '{"{"}"circuits": [{"{"}
						{"\n"}
						{"    "}"chainId": 56,{"\n"}
						{"    "}"processor": "{EXAMPLE.processor}",{"\n"}
						{"    "}"tokenId": "{EXAMPLE.tokenId}"{"\n"}
						{"  "}
						{"}"}]{"}"}'
					</pre>
				</div>
				<div>
					<div className={s.label}>Foreman answers, live on 26 Nov 2026</div>
					<div className={s.answer}>
						<div className={s.who}>
							Circuit #8044 · processor ×1 · BNB Chain
						</div>
						<h2>Copy of circuit #53, taped out 4 days earlier</h2>
						<p>
							Byte-identical netlist <span className={s.mono}>0x9679…e346</span>
							. The earliest proven design is the original.
						</p>
						<ul>
							<li>
								<span>Can mine</span>
								<b>Mining now, without the design bonus</b>
							</li>
							<li>
								<span>Checked</span>
								<b>87,647 circuits, to BNB block 135,854,947</b>
							</li>
							<li>
								<span>Published</span>
								<b>
									X Layer testnet, <span className={s.mono}>0x3d9a…2196</span>
								</b>
							</li>
						</ul>
					</div>
				</div>
			</div>
			<p className={s.limit}>
				Checks identical netlists, including swapped gate inputs. A copy with
				its gates reordered isn’t detected. A circuit Foreman can’t check says
				why, never a verdict. The full answer is JSON; its shapes are in the
				README.
			</p>

			<MakeKey />
			<PayBand />
		</div>
	);
}

type Step =
	| { at: "idle" }
	| { at: "signing" }
	| { at: "making" }
	| { at: "made"; key: string }
	| { at: "problem"; detail: string };

/** The band: connect, sign, and the key once. */
function MakeKey() {
	const { address } = useConnection();
	const sign = useSignMessage();
	const [step, setStep] = useState<Step>({ at: "idle" });
	const [copied, setCopied] = useState(false);
	const queries = useQueryClient();
	// Whether this wallet already has a key, so the band says so rather than offering a first one. If
	// the read fails the band still says a new key ends the old
	const status = useQuery({
		queryKey: ["api-key", address?.toLowerCase()],
		queryFn: () => readApiKeyStatus((address as string).toLowerCase()),
		enabled: Boolean(address),
	});
	const madeAt = address ? (status.data?.madeAt ?? null) : null;

	// A different wallet starts over, and the shown key goes with the wallet that made it
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on a change of wallet only
	useEffect(() => {
		setStep({ at: "idle" });
		setCopied(false);
	}, [address]);

	async function make() {
		if (!address) return;
		const wallet = parseAddress(address.toLowerCase(), "wallet");
		const message = apiKeyMessage(wallet, new Date());
		setStep({ at: "signing" });
		setCopied(false);
		let signature: `0x${string}`;
		try {
			signature = await sign.mutateAsync({ message });
		} catch (error) {
			const name = (error as { name?: string }).name ?? "";
			setStep({
				at: "problem",
				detail: /UserRejected/.test(name)
					? "You didn’t sign, so no key was made."
					: "Your wallet couldn’t sign the message, so no key was made.",
			});
			return;
		}
		setStep({ at: "making" });
		try {
			const made = await createApiKey({ wallet, message, signature });
			setStep({ at: "made", key: made.key });
			void queries.invalidateQueries({ queryKey: ["api-key"] });
		} catch (error) {
			setStep({
				at: "problem",
				detail:
					error instanceof ApiProblem
						? error.problem.detail
						: "Foreman couldn’t make the key. Try again.",
			});
		}
	}

	async function copy(key: string) {
		try {
			await navigator.clipboard.writeText(key);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	// The key, once: the band becomes it (2026-11-26-for-markets.html, "the key, once it's made")
	if (step.at === "made" && address) {
		return (
			<section className={s.made} aria-labelledby="your-key">
				<div className={s.madeHead}>
					<h2 id="your-key">Your API key</h2>
					<span className={s.madeFor}>
						Made for {shortHex(address.toLowerCase())}
					</span>
				</div>
				<div className={s.bigKey}>
					<code>{step.key}</code>
					<button type="button" onClick={() => copy(step.key)}>
						{copied ? "Copied" : "Copy key"}
					</button>
				</div>
				<div className={s.notes}>
					<p>
						<b>Shown once</b>Save it now. Foreman keeps only a scrambled copy
						and can’t show it again.
					</p>
					<p>
						<b>From your server</b>Send it as Authorization: Bearer. Never put
						it in a web page.
					</p>
					<p>
						<b>No expiry</b>It works until this wallet makes a new key. 60 calls
						a minute, or 600 while this wallet has paid.
					</p>
				</div>
				<pre className={s.code}>
					<span className={s.k}>curl</span> -X POST {API_URL}/v1/results \{"\n"}
					{"  "}-H <span className={s.k}>"Authorization: Bearer fmn_…"</span>
					{' -H "Content-Type: application/json" \\\n'}
					{"  "}-d '{"{"}"circuits": [{"{"}"chainId": 56, "processor": "
					{EXAMPLE.processor}", "tokenId": "{EXAMPLE.tokenId}"{"}"}]{"}"}'
				</pre>
				<button type="button" className={s.again} onClick={make}>
					Make a new key (ends this one)
				</button>
			</section>
		);
	}

	return (
		<section className={s.band} aria-labelledby="make-key">
			<div>
				<h2 id="make-key">
					{madeAt !== null ? "This wallet has a key" : "Make your key"}
				</h2>
				<p>
					{madeAt !== null
						? `Made ${formatDate(madeAt)} for ${shortHex((address as string).toLowerCase())}. Foreman keeps only a scrambled copy, so it can’t show the key again. Lost it? Sign to make a new one; the old one stops working at once.`
						: address
							? `Sign a message with ${shortHex(address.toLowerCase())}.`
							: "Connect a wallet, then sign a message."}{" "}
					{madeAt !== null
						? "Signing is free: no transaction, no gas."
						: "Signing is free: no transaction, no gas. One key per wallet, shown once; it doesn’t expire, and a new one ends the old. 60 calls a minute."}
				</p>
			</div>
			<div>
				{!address ? (
					<div className={s.connect}>
						<WalletButton big />
					</div>
				) : (
					<button
						type="button"
						className={madeAt !== null ? s.ghost : s.cta}
						onClick={make}
						disabled={step.at === "signing" || step.at === "making"}
					>
						{step.at === "signing"
							? "Waiting for your wallet…"
							: step.at === "making"
								? "Making your key…"
								: madeAt !== null
									? "Sign to make a new key"
									: "Sign to make a key"}
					</button>
				)}
				{step.at === "problem" && (
					<p className={s.problem} role="alert">
						{step.detail}
					</p>
				)}
				<p className={s.fine}>
					Use the key from your server, never in a web page.
				</p>
			</div>
		</section>
	);
}

/** 30 days, in seconds: what one payment adds. */
const PAID_DAYS = 30n * 86_400n;

/**
 * The pay band, once the connected wallet has a key (2026-11-26-paid-api-tier.md, decision 6). The
 * wallet pays with its own code; after the API counts it, the key status is read again for when the
 * 600 a minute ends. The page never works out what was paid: the API does.
 */
function PayBand() {
	const { address } = useConnection();
	const queries = useQueryClient();
	const wallet = address?.toLowerCase();
	const status = useQuery({
		queryKey: ["api-key", wallet],
		queryFn: () => readApiKeyStatus(wallet as string),
		enabled: Boolean(wallet),
	});
	if (!wallet || !status.data?.madeAt) return null;
	return (
		<Pay
			wallet={wallet}
			paidUntil={status.data.paidUntil}
			refresh={() => queries.invalidateQueries({ queryKey: ["api-key"] })}
		/>
	);
}

function Pay({
	wallet,
	paidUntil,
	refresh,
}: {
	wallet: string;
	paidUntil: bigint | null;
	refresh: () => Promise<void>;
}) {
	const pay = useProPayment(apiPaymentCode(wallet));
	const { step } = pay;

	// Once counted, the key status says the new end
	// biome-ignore lint/correctness/useExhaustiveDependencies: on a counted payment only
	useEffect(() => {
		if (step.at === "counted") void refresh();
	}, [step.at]);

	const now = BigInt(Math.floor(Date.now() / 1000));
	const after =
		(paidUntil !== null && paidUntil > now ? paidUntil : now) + PAID_DAYS;
	const label =
		paidUntil !== null ? "Add 30 days for 0.01 test OKB" : "Pay 0.01 test OKB";

	const button = !pay.onTestnet ? (
		<button
			type="button"
			className={paidUntil !== null ? s.ghost : s.cta}
			disabled={pay.switching}
			onClick={pay.switchToTestnet}
		>
			{pay.switching ? "Waiting for your wallet…" : "Switch to X Layer testnet"}
		</button>
	) : (
		<button
			type="button"
			className={paidUntil !== null ? s.ghost : s.cta}
			onClick={pay.pay}
			disabled={pay.busy || pay.short || !pay.ready}
		>
			{step.at === "wallet"
				? "Confirm in your wallet…"
				: step.at === "block"
					? "Waiting for a block…"
					: step.at === "counting"
						? "Counting your payment…"
						: label}
		</button>
	);

	const tx =
		step.at === "block" ||
		step.at === "counting" ||
		step.at === "counted" ||
		step.at === "uncounted" ? (
			<span className={s.mono} title={step.hash}>
				{shortHex(step.hash)}
			</span>
		) : null;

	return (
		<section className={s.paid} aria-labelledby="paid-calls" aria-live="polite">
			<div>
				{paidUntil !== null ? (
					<>
						<span className={s.ok}>
							<i aria-hidden="true" />
							Paid
						</span>
						<h2 id="paid-calls" className={s.paidHead}>
							600 calls a minute until {formatDate(paidUntil)}
						</h2>
						<p>
							Then back to 60; the key keeps working. Paying again adds 30 days.
						</p>
					</>
				) : (
					<>
						<h2 id="paid-calls">
							<span className={s.tenx}>10×</span>the calls
						</h2>
						<p>
							600 calls a minute instead of 60, for 30 days. The same answers
							and up to 100 circuits a call. It stays with this wallet, even if
							you make a new key; when it ends, the key goes back to 60 and
							keeps working.
						</p>
					</>
				)}
			</div>
			<div>
				<dl className={s.facts}>
					{paidUntil !== null ? (
						<>
							<dt>Now</dt>
							<dd>600 calls a minute</dd>
							<dt>Ends</dt>
							<dd>{formatDate(paidUntil)}</dd>
						</>
					) : (
						<>
							<dt>Now</dt>
							<dd>60 calls a minute</dd>
							<dt>After paying</dt>
							<dd>600 until {formatDate(after)}</dd>
							<dt>Amount</dt>
							<dd>0.01 test OKB, X Layer testnet</dd>
							<dt>This wallet holds</dt>
							<dd>
								{pay.held === undefined
									? pay.heldUnreadable
										? "Couldn’t read"
										: "…"
									: `${okb(pay.held)} test OKB`}
							</dd>
						</>
					)}
				</dl>
				{button}
				{pay.short && pay.held !== undefined && pay.onTestnet && (
					<p className={`${s.fine} ${s.problem}`} role="alert">
						This wallet holds {okb(pay.held)} test OKB; paying needs 0.01 and a
						small network fee. The{" "}
						<a href={FAUCET_URL} target="_blank" rel="noreferrer">
							X Layer testnet faucet
						</a>{" "}
						gives test OKB free.
					</p>
				)}
				{step.at === "problem" && (
					<p className={`${s.fine} ${s.problem}`} role="alert">
						{step.detail}
					</p>
				)}
				{(step.at === "block" || step.at === "counting") && (
					<p className={s.fine}>
						Sent in transaction {tx}. A block on the X Layer testnet can take a
						minute or two.
					</p>
				)}
				{step.at === "counted" && (
					<p className={s.fine}>Payment counted, in transaction {tx}.</p>
				)}
				{step.at === "uncounted" && (
					<p className={s.fine}>
						Paid in transaction {tx}. Foreman couldn’t count it yet; it reads
						every payment from the chain itself, so it counts this one within
						about half an hour. Nothing more to do.
					</p>
				)}
				{paidUntil === null && (
					<p className={s.fine}>
						A test payment: the real price isn’t set. To Foreman’s contract{" "}
						<span className={s.mono}>{shortHex(FOREMAN_PRO.address)}</span>,
						plus a small network fee.
					</p>
				)}
			</div>
		</section>
	);
}
