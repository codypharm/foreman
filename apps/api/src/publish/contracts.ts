// Where results are published (docs/decisions/2026-11-21-publish-job.md, "The contract address").
// The addresses live in @foreman/chain-xlayer/results; a chain without one is refused by `--send`.

export {
	RESULTS_CONTRACTS,
	type ResultsChain,
	XLAYER_RPC,
} from "@foreman/chain-xlayer/results";

/** Entries per transaction until the testnet measures it (2026-11-21-results-contract.md). */
export const DEFAULT_BATCH_SIZE = 100;
