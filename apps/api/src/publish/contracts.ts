// Where results are published (docs/decisions/2026-11-21-publish-job.md, "The contract address").
// A ForemanResults address goes here only once William has deployed it and it is listed in
// CLAUDE.md's On-chain facts. Until then `--send` refuses that chain.

import { type Address, parseAddress } from "@foreman/contract";

export type ResultsChain = 196 | 1952;

export const RESULTS_CONTRACTS: Record<ResultsChain, Address | null> = {
	196: null,
	// Testnet, deployed by William and confirmed on chain, 21 Nov 2026 (CLAUDE.md, On-chain facts)
	1952: parseAddress(
		"0xe1b2343d3da66afec740c0fcaf40a701e2d513e8",
		"ForemanResults",
	),
};

/** X Layer's public RPCs (contracts/foundry.toml); XLAYER_RPC_URL overrides. */
export const XLAYER_RPC: Record<ResultsChain, string> = {
	196: "https://rpc.xlayer.tech",
	1952: "https://testrpc.xlayer.tech",
};

/** Entries per transaction until the testnet measures it (2026-11-21-results-contract.md). */
export const DEFAULT_BATCH_SIZE = 100;
