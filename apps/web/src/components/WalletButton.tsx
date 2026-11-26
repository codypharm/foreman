// Connect wallet (docs/decisions/2026-11-23-wallet-connect.md): one wallet found connects at once,
// several open a short list with OKX Wallet first, none says how to get one. Connected, it shows the
// address with a menu for Your miners and Disconnect. Foreman reads the address. It asks for a
// signature only on the API page, to make an API key (docs/decisions/2026-11-26-self-serve-api-keys.md),
// and a transaction only on the Pro page, to pay for Foreman Pro (2026-11-26-pro-payments.md).

import { useEffect, useRef, useState } from "react";
import {
	type Connector,
	useConnect,
	useConnection,
	useConnectors,
	useDisconnect,
} from "wagmi";
import { Link } from "wouter";
import { shortHex } from "../format.ts";
import { walletChoices, walletName } from "../wallet.ts";
import s from "./WalletButton.module.css";

export function WalletButton({
	big = false,
	label = "Connect wallet",
}: {
	big?: boolean;
	/** The button's words before a wallet is connected. */
	label?: string;
}) {
	const { address, status } = useConnection();
	const connectors = useConnectors();
	const connect = useConnect();
	const disconnect = useDisconnect();
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			if (!box.current?.contains(e.target as Node)) setOpen(false);
		};
		const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", away);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("pointerdown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);

	const choices = walletChoices(connectors);
	const pending = connect.isPending || status === "connecting";

	function start(connector: Connector) {
		connect.mutate(
			{ connector },
			{ onSuccess: () => setOpen(false), onError: () => setOpen(true) },
		);
	}

	function press() {
		if (address) return setOpen((o) => !o);
		connect.reset();
		const only = choices.length === 1 ? choices[0] : undefined;
		if (only) start(only);
		else setOpen((o) => !o);
	}

	return (
		<div className={s.box} ref={box}>
			<button
				type="button"
				className={big ? s.big : s.wallet}
				onClick={press}
				disabled={pending}
				aria-expanded={open}
				aria-haspopup="menu"
			>
				{address ? (
					<>
						<i className={s.dot} aria-hidden="true" />
						{shortHex(address.toLowerCase())}
					</>
				) : pending ? (
					"Connecting…"
				) : (
					label
				)}
			</button>
			{open && (
				<div className={big ? `${s.menu} ${s.under}` : s.menu} role="menu">
					{address ? (
						<>
							<Link
								href="/wallet"
								role="menuitem"
								className={s.item}
								onClick={() => setOpen(false)}
							>
								Your miners
							</Link>
							<button
								type="button"
								role="menuitem"
								className={s.item}
								onClick={() => {
									disconnect.mutate();
									setOpen(false);
								}}
							>
								Disconnect
							</button>
						</>
					) : choices.length === 0 ? (
						<p className={s.words}>
							No wallet found in this browser. Open Foreman in OKX Wallet’s
							browser, or install a wallet extension and reload.
						</p>
					) : (
						<>
							{choices.length > 1 && <p className={s.head}>Choose a wallet</p>}
							{choices.map((c) => (
								<button
									key={c.uid}
									type="button"
									role="menuitem"
									className={s.item}
									onClick={() => start(c)}
									disabled={pending}
								>
									{c.icon ? (
										<img src={c.icon} alt="" width="20" height="20" />
									) : (
										<span className={s.noicon} aria-hidden="true" />
									)}
									{walletName(c)}
								</button>
							))}
						</>
					)}
					{connect.error && !address && (
						<p className={s.problem} role="alert">
							The wallet didn’t connect: {plain(connect.error)}
						</p>
					)}
					{!address && (
						<p className={s.foot}>
							Foreman reads your address to show your miners. It asks for a
							signature only when you make an API key, and sends a payment only
							when you pay for Foreman Pro.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function plain(error: Error): string {
	const short = (error as { shortMessage?: string }).shortMessage;
	return short ?? error.message;
}
