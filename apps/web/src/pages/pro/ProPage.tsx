// Foreman Pro, at #/pro/<code> and #/pro (docs/mocks/2026-11-26-pro-page.html, option A "checkout",
// chosen 26 Nov 2026; docs/decisions/2026-11-26-pro-payments.md). With a chat's code from the bot's
// /pro, it pays ForemanPro on the X Layer testnet and reports the transaction to the API, which reads
// the receipt itself and says when that chat's Pro now ends. Without a code it can't pay, so it sends
// people to the bot. Nothing here decides what was paid: the chain and the API do.

import {
	FOREMAN_PRO,
	foremanProAbi,
	PRO_PRICE_WEI,
	proCodeWord,
} from "@foreman/chain-xlayer/pro";
import { type Hex32, parseHex32 } from "@foreman/contract";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
	useBalance,
	useConnection,
	usePublicClient,
	useSwitchChain,
	useWriteContract,
} from "wagmi";
import { useParams } from "wouter";
import { ApiProblem, reportProPayment } from "../../api.ts";
import { WalletButton } from "../../components/WalletButton.tsx";
import { formatDate, shortHex } from "../../format.ts";
import { xLayerTestnet } from "../../wallet.ts";
import s from "./ProPage.module.css";

/** Foreman's Telegram bot, where /pro gives a chat its pay link. */
const BOT_URL = "https://t.me/ForemanCopyAlertsBot";
/** The X Layer team's testnet faucet, on OKX's own site: 0.2 test OKB a day (checked 26 Nov 2026). */
const FAUCET_URL = "https://web3.okx.com/xlayer/faucet";

/** Tries of the report while the API can't read the transaction yet, 3 seconds apart. */
const REPORT_TRIES = 10;

export function ProPage() {
	const params = useParams<{ code?: string }>();
	useEffect(() => {
		document.title = "Foreman · Pro";
		return () => {
			document.title = "Foreman · Live listings";
		};
	}, []);

	const raw = params.code?.toLowerCase();
	const code = raw && /^[0-9a-f]{32}$/.test(raw) ? (`0x${raw}` as const) : null;

	return (
		<div className={s.page}>
			<div className={s.col}>
				<div className={s.eyebrow}>
					Foreman Pro{params.code ? " · for one Telegram chat" : ""}
				</div>
				<h1>Copy alerts for up to 20 addresses</h1>
				{params.code === undefined ? (
					<NoCode />
				) : code === null ? (
					<NotACode />
				) : (
					<Checkout code={code} />
				)}
			</div>
		</div>
	);
}

/** #/pro: what Pro gives, and the bot, which knows the chat. */
function NoCode() {
	return (
		<>
			<p className={s.lead}>
				Foreman’s Telegram bot messages a chat when a copy of a followed
				wallet’s miner is listed. One address is free; Pro raises it to 20 for
				30 days, for 0.01 test OKB on the X Layer testnet. A test payment: the
				real price isn’t set.
			</p>
			<BotCard line="Send /pro in your chat to get its pay link." />
			<Rules short />
		</>
	);
}

function NotACode() {
	return (
		<>
			<p className={s.lead}>
				This link isn’t a chat’s pay link, so nothing can be paid from it.
			</p>
			<BotCard line="Send /pro to the bot for this chat’s link." />
		</>
	);
}

function BotCard({ line }: { line: string }) {
	return (
		<div className={s.bot}>
			<span className={s.botIcon} aria-hidden="true">
				<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
					<path
						d="M21.5 4.2 2.9 11.4c-1 .4-1 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.7 3.5c.7.5 1.7.1 1.9-.7l3.2-15.1c.2-1-.8-1.9-1.7-1.5Z"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinejoin="round"
					/>
					<path
						d="m7.6 14.7 9.6-6.3-6.9 7.6"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinejoin="round"
					/>
				</svg>
			</span>
			<div>
				<b>@ForemanCopyAlertsBot</b>
				<span>{line}</span>
			</div>
			<a className={s.ghost} href={BOT_URL} target="_blank" rel="noreferrer">
				Open the bot
			</a>
		</div>
	);
}

function Rules({ short = false }: { short?: boolean }) {
	return (
		<>
			{!short && <h2 className={s.sec}>What Pro changes</h2>}
			<ul className={short ? `${s.rules} ${s.rulesShort}` : s.rules}>
				{!short && (
					<li>
						<span>Addresses</span>Up to 20 followed in this chat, each sending
						its copy alerts
					</li>
				)}
				{!short && (
					<li>
						<span>When it’s ending</span>The bot says so 3 days before and on
						the day, with this link
					</li>
				)}
				<li>
					<span>When it ends</span>Every follow is kept. Only the first address
					{short ? " the chat" : " this chat"} followed sends
					{short
						? ""
						: "; copies listed meanwhile for the rest aren’t sent later"}
				</li>
				<li>
					<span>Paying again</span>Adds 30 days and every follow sends again
				</li>
			</ul>
		</>
	);
}

type Step =
	| { at: "idle" }
	| { at: "wallet" }
	| { at: "block"; hash: Hex32 }
	| { at: "counting"; hash: Hex32 }
	| { at: "counted"; hash: Hex32; proUntil: bigint | null }
	/** Paid, but the API hasn't counted it: the worker's own read will. */
	| { at: "uncounted"; hash: Hex32 }
	| { at: "problem"; detail: string };

/** #/pro/<code>: what this pays for, one button, then the rules. */
function Checkout({ code }: { code: `0x${string}` }) {
	const { address, chainId } = useConnection();
	const balance = useBalance({
		address,
		chainId: xLayerTestnet.id,
		query: { enabled: Boolean(address) },
	});
	const client = usePublicClient({ chainId: xLayerTestnet.id });
	const switchChain = useSwitchChain();
	const write = useWriteContract();
	const [step, setStep] = useState<Step>({ at: "idle" });

	// Another wallet starts over
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on a change of wallet only
	useEffect(() => {
		setStep((now) =>
			now.at === "idle" || now.at === "problem" ? { at: "idle" } : now,
		);
	}, [address]);

	if (step.at === "counted" || step.at === "uncounted") {
		return <Paid step={step} />;
	}

	const busy =
		step.at === "wallet" || step.at === "block" || step.at === "counting";
	const onTestnet = chainId === xLayerTestnet.id;
	const held = balance.data?.value;
	const short = held !== undefined && held < PRO_PRICE_WEI;

	async function pay() {
		if (!address || !client) return;
		setStep({ at: "wallet" });
		let hash: Hex32;
		try {
			hash = parseHex32(
				(
					await write.mutateAsync({
						address: FOREMAN_PRO.address as `0x${string}`,
						abi: foremanProAbi,
						functionName: "pay",
						args: [proCodeWord(code)],
						value: PRO_PRICE_WEI,
						chainId: xLayerTestnet.id,
					})
				).toLowerCase(),
				"tx",
			);
		} catch (error) {
			const name = (error as { name?: string }).name ?? "";
			setStep({
				at: "problem",
				detail: /UserRejected/.test(name)
					? "You didn’t confirm in your wallet, so nothing was paid."
					: "Your wallet couldn’t send the payment, so nothing was paid.",
			});
			return;
		}

		// X Layer receipts can take minutes (CLAUDE.md, "X Layer public node limits")
		setStep({ at: "block", hash });
		try {
			const receipt = await client.waitForTransactionReceipt({
				hash,
				timeout: 180_000,
			});
			if (receipt.status !== "success") {
				setStep({
					at: "problem",
					detail: "The payment failed on chain, so nothing was paid.",
				});
				void balance.refetch();
				return;
			}
		} catch {
			// The receipt read gave up; the payment may still land. The API and the worker read it
			// from the chain, so it is counted if it did
			setStep({ at: "uncounted", hash });
			return;
		}
		void balance.refetch();

		setStep({ at: "counting", hash });
		for (let i = 0; i < REPORT_TRIES; i++) {
			try {
				const answer = await reportProPayment(hash);
				setStep({ at: "counted", hash, proUntil: answer.proUntil });
				return;
			} catch (error) {
				const notYet =
					error instanceof ApiProblem && error.problem.error === "not-ready";
				if (!notYet) break;
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
		setStep({ at: "uncounted", hash });
	}

	return (
		<>
			<p className={s.lead}>
				Without Pro, a chat gets copy alerts for <b>one</b> address. Pro raises
				that to <b>20</b> for 30 days.
			</p>

			<section className={s.bill} aria-labelledby="paying-for">
				<div className={s.billHead}>
					<h2 id="paying-for">You’re paying for</h2>
					<span className={s.mono}>Chat {shortHex(code).slice(2)}</span>
				</div>
				<dl className={s.facts}>
					<dt>Foreman Pro</dt>
					<dd>30 days, added to what’s left</dd>
					<dt>Amount</dt>
					<dd>0.01 test OKB</dd>
					<dt>Network</dt>
					<dd>X Layer testnet</dd>
					{address && (
						<>
							<dt>Your wallet holds</dt>
							<dd>
								{held === undefined
									? balance.isError
										? "Couldn’t read"
										: "…"
									: `${okb(held)} test OKB`}
							</dd>
						</>
					)}
				</dl>

				{!address ? (
					<div className={s.connect}>
						<WalletButton big label="Connect wallet to pay" />
					</div>
				) : !onTestnet ? (
					<button
						type="button"
						className={s.cta}
						disabled={switchChain.isPending}
						onClick={() =>
							switchChain.mutate(
								{ chainId: xLayerTestnet.id },
								{
									onError: () =>
										setStep({
											at: "problem",
											detail:
												"Your wallet didn’t switch to the X Layer testnet. Switch it there, then pay.",
										}),
								},
							)
						}
					>
						{switchChain.isPending
							? "Waiting for your wallet…"
							: "Switch to X Layer testnet"}
					</button>
				) : (
					<button
						type="button"
						className={s.cta}
						onClick={pay}
						disabled={busy || short || !client}
					>
						{step.at === "wallet"
							? "Confirm in your wallet…"
							: step.at === "block"
								? "Waiting for a block…"
								: step.at === "counting"
									? "Counting your payment…"
									: "Pay 0.01 test OKB"}
					</button>
				)}

				{short && held !== undefined && onTestnet && (
					<p className={s.problem} role="alert">
						This wallet holds {okb(held)} test OKB; paying needs 0.01 and a
						small network fee. The{" "}
						<a href={FAUCET_URL} target="_blank" rel="noreferrer">
							X Layer testnet faucet
						</a>{" "}
						gives test OKB free.
					</p>
				)}
				{step.at === "problem" && (
					<p className={s.problem} role="alert">
						{step.detail}
					</p>
				)}
				{(step.at === "block" || step.at === "counting") && (
					<p className={s.fine}>
						Sent in transaction{" "}
						<span className={s.mono} title={step.hash}>
							{shortHex(step.hash)}
						</span>
						. A block on the X Layer testnet can take a minute or two.
					</p>
				)}
				<p className={s.fine}>
					A test payment: the real price isn’t set. It goes to Foreman’s
					contract{" "}
					<span className={s.mono}>{shortHex(FOREMAN_PRO.address)}</span>, which
					anyone can check, and your wallet adds a small network fee. Anyone can
					pay for any chat, so Pro can be a gift.
				</p>
			</section>

			<Rules />
		</>
	);
}

function Paid({
	step,
}: {
	step:
		| { at: "counted"; hash: Hex32; proUntil: bigint | null }
		| { at: "uncounted"; hash: Hex32 };
}) {
	const tx = (
		<span className={s.mono} title={step.hash}>
			{shortHex(step.hash)}
		</span>
	);
	return (
		<section className={s.paid} aria-live="polite">
			{step.at === "counted" && step.proUntil !== null ? (
				<>
					<span className={s.ok}>
						<i aria-hidden="true" />
						Payment counted
					</span>
					<h2>Foreman Pro until {formatDate(step.proUntil)}</h2>
					<p>
						The bot tells the chat now. Send /follow 0x… there to add addresses,
						up to 20.
					</p>
				</>
			) : step.at === "counted" ? (
				<>
					<h2>Paid, but no chat has this code</h2>
					<p>
						The payment counted for no chat, so no chat’s Pro changed. Send /pro
						to the bot in your chat to check its pay link.
					</p>
				</>
			) : (
				<>
					<h2>Paid. Foreman counts it soon</h2>
					<p>
						Foreman couldn’t count it yet. It also reads every payment from the
						chain itself, so it counts this one within about half an hour, and
						the bot tells the chat. Nothing more to do.
					</p>
				</>
			)}
			<p className={s.tx}>Paid in X Layer testnet transaction {tx}</p>
		</section>
	);
}

/** Test OKB from wei, to at most 4 decimals: "0.42", "0.0041". Display only. */
function okb(wei: bigint): string {
	const [whole, frac = ""] = formatUnits(wei, 18).split(".");
	const cut = frac.slice(0, 4).replace(/0+$/, "");
	return cut ? `${whole}.${cut}` : (whole ?? "0");
}
