// Wallet connection (docs/decisions/2026-11-23-wallet-connect.md): wagmi with injected wallets only,
// found through EIP-6963, OKX Wallet first. Foreman reads the connected address to show its miners.
// It asks for a signature only to make an API key on the API page
// (docs/decisions/2026-11-26-self-serve-api-keys.md), and a transaction only when someone pays for
// Foreman Pro, on the X Layer testnet (docs/decisions/2026-11-26-pro-payments.md).

import { XLAYER_RPC } from "@foreman/chain-xlayer/results";
import {
	type Connector,
	createConfig,
	createStorage,
	http,
	injected,
	mock,
} from "wagmi";
import { bsc, xLayerTestnet as viemXLayerTestnet } from "wagmi/chains";

const OKX_RDNS = "com.okex.wallet";

/** The X Layer testnet, named as Foreman names it (viem calls it "X1 Testnet"): a wallet asked to switch
 * to it shows this name. Foreman Pro is paid here (2026-11-26-pro-payments.md). */
export const xLayerTestnet = {
	...viemXLayerTestnet,
	name: "X Layer testnet",
} as const;

/** Development only: VITE_DEV_WALLET connects a read-only stand-in for that address, so the page can be
 * checked in a browser without a wallet extension. Never in a production build. */
const DEV_WALLET = import.meta.env.DEV
	? (import.meta.env.VITE_DEV_WALLET as string | undefined)
	: undefined;

/** localStorage, or nothing when the browser refuses it (private windows, blocked site data). */
const safeStorage = {
	getItem(key: string) {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	setItem(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {}
	},
	removeItem(key: string) {
		try {
			localStorage.removeItem(key);
		} catch {}
	},
};

export const wagmiConfig = createConfig({
	chains: [bsc, xLayerTestnet],
	// The window.ethereum wallet when it doesn't announce itself through EIP-6963
	connectors: [
		injected(),
		...(DEV_WALLET && /^0x[0-9a-fA-F]{40}$/.test(DEV_WALLET)
			? [
					mock({
						accounts: [DEV_WALLET as `0x${string}`],
						features: { reconnect: true },
					}),
				]
			: []),
	],
	multiInjectedProviderDiscovery: true,
	storage: createStorage({ storage: safeStorage, key: "foreman.wallet" }),
	// No reads go through the wallet's chain: the API reads BNB Chain and X Layer. The Pro page alone
	// reads the X Layer testnet here: the payer's balance and the payment's receipt
	transports: {
		[bsc.id]: http(),
		[xLayerTestnet.id]: http(XLAYER_RPC[xLayerTestnet.id]),
	},
});

declare module "wagmi" {
	interface Register {
		config: typeof wagmiConfig;
	}
}

/**
 * The wallets to offer, OKX Wallet first. A wallet that announced itself (EIP-6963) replaces the
 * plain window.ethereum entry, which is kept only when nothing announced and window.ethereum exists.
 */
export function walletChoices(connectors: readonly Connector[]): Connector[] {
	const announced = connectors.filter(
		(c) => c.type === "injected" && c.id !== "injected",
	);
	const plain = connectors.filter((c) => c.id === "injected");
	const devs = connectors.filter((c) => c.type === "mock");
	const hasWindowEthereum =
		typeof window !== "undefined" &&
		(window as { ethereum?: unknown }).ethereum !== undefined;
	const list = [
		...announced,
		...(announced.length === 0 && hasWindowEthereum ? plain : []),
		...devs,
	];
	return list.sort((a, b) => Number(isOkx(b)) - Number(isOkx(a)));
}

function isOkx(c: Connector): boolean {
	return c.id === OKX_RDNS || /okx/i.test(c.name);
}

/** "OKX Wallet", or "Browser wallet" for the plain window.ethereum entry. */
export function walletName(c: Connector): string {
	if (c.type === "mock") return "Development wallet";
	return c.id === "injected" ? "Browser wallet" : c.name;
}
