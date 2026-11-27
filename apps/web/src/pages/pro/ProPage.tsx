// Foreman Pro, at #/pro/<code> and #/pro (docs/mocks/2026-11-26-pro-page.html, option A "checkout",
// chosen 26 Nov 2026; docs/decisions/2026-11-26-pro-payments.md). With a chat's code from the bot's
// /pro, it pays ForemanPro on the X Layer testnet and reports the transaction to the API, which reads
// the receipt itself and says when that chat's Pro now ends. Without a code it can't pay, so it sends
// people to the bot. Nothing here decides what was paid: the chain and the API do.

import { FOREMAN_PRO, proCodeWord } from "@foreman/chain-xlayer/pro";
import type { Hex32 } from "@foreman/contract";
import { useEffect } from "react";
import { useParams } from "wouter";
import { WalletButton } from "../../components/WalletButton.tsx";
import { formatDate, shortHex } from "../../format.ts";
import { FAUCET_URL, okb, useProPayment } from "../../pay.ts";
import s from "./ProPage.module.css";

/** Foreman's Telegram bot, where /pro gives a chat its pay link. */
const BOT_URL = "https://t.me/ForemanCopyAlertsBot";

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

/** #/pro/<code>: what this pays for, one button, then the rules. */
function Checkout({ code }: { code: `0x${string}` }) {
	const {
		address,
		step,
		pay,
		switchToTestnet,
		switching,
		onTestnet,
		held,
		heldUnreadable,
		short,
		busy,
		ready,
	} = useProPayment(proCodeWord(code));

	if (step.at === "counted" || step.at === "uncounted") {
		return <Paid step={step} />;
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
									? heldUnreadable
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
						disabled={switching}
						onClick={switchToTestnet}
					>
						{switching
							? "Waiting for your wallet…"
							: "Switch to X Layer testnet"}
					</button>
				) : (
					<button
						type="button"
						className={s.cta}
						onClick={pay}
						disabled={busy || short || !ready}
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
