// The results contract, for the publish job and the result page's read-back. No Node-only imports, so
// the web app can load it as "@foreman/chain-xlayer/results".

export { changeFingerprint } from "./fingerprint.ts";
export {
	type PublishedReadBack,
	ReadBackError,
	type ReadBackFailure,
	readPublishedResult,
} from "./published-result.ts";
export {
	foremanResultsAbi,
	RESULTS_CONTRACTS,
	type ResultsChain,
	shortVerdict,
	XLAYER_RPC,
} from "./results-contract.ts";
