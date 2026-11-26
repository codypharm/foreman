// X Layer mainnet nodes for FabX's reads (docs/decisions/2026-11-26-fabx-follow.md, decision 2):
// XLAYER_MAINNET_RPC_URL when set, then the three public nodes in turn. XLAYER_RPC_URL is the
// publisher's (the testnet), never read here. Callers check the chain id before trusting a read.

import { createPublicClient, fallback, http, type PublicClient } from "viem";

/** X Layer mainnet's public nodes; all serve old state, logs 100 blocks per read (25 Nov 2026). */
export const XLAYER_PUBLIC_NODES = [
	"https://rpc.xlayer.tech",
	"https://xlayerrpc.okx.com",
	"https://xlayer.drpc.org",
] as const;

export function xlayerMainnet(url?: string): {
	/** State reads (netlists, miner records, block times), moving to the next node on failure. */
	client: PublicClient;
	/** One client per node, for log reads shared between them. */
	logNodes: PublicClient[];
} {
	const urls = [...(url ? [url] : []), ...XLAYER_PUBLIC_NODES];
	return {
		client: createPublicClient({
			transport: fallback(urls.map((u) => http(u, { timeout: 30_000 }))),
		}),
		logNodes: urls.map((u) =>
			createPublicClient({
				transport: http(u, { retryCount: 0, timeout: 20_000 }),
			}),
		),
	};
}
