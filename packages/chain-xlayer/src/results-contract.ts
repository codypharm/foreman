// ForemanResults, Foreman's results contract on X Layer (contracts/src/ForemanResults.sol;
// docs/decisions/2026-11-21-results-contract.md): where it is, how to reach it, its ABI and its short
// verdict codes. Shared by the publish job and the result page's read-back, so both use the same rules.
// No Node-only imports: the web app loads this through "@foreman/chain-xlayer/results".

import {
	type Address,
	type Originality,
	parseAddress,
} from "@foreman/contract";

export type ResultsChain = 196 | 1952;

/** A ForemanResults address goes here only once William has deployed it and it is in CLAUDE.md's On-chain facts. */
export const RESULTS_CONTRACTS: Record<ResultsChain, Address | null> = {
	196: null,
	// Testnet, deployed by William and confirmed on chain, 21 Nov 2026 (CLAUDE.md, On-chain facts)
	1952: parseAddress(
		"0xe1b2343d3da66afec740c0fcaf40a701e2d513e8",
		"ForemanResults",
	),
};

/** X Layer's public RPCs (contracts/foundry.toml). Both allow calls from a web page (23 Nov 2026). */
export const XLAYER_RPC: Record<ResultsChain, string> = {
	196: "https://rpc.xlayer.tech",
	1952: "https://testrpc.xlayer.tech",
};

const KIND: Record<Originality["result"]["verdict"], number> = {
	"no-earlier-copy": 1,
	copy: 2,
	"too-small-to-tell": 3,
	wrapper: 4,
	"cant-check": 5,
};

const CAN_MINE = {
	mining: 1,
	"cant-mine": 2,
	stopped: 3,
	"not-started": 4,
} as const;

/** The results contract's short verdict codes (ForemanResults.sol, Verdict). */
export function shortVerdict(o: Originality): {
	kind: number;
	canMine: number;
} {
	const fact = o.facts.find((f) => f.fact === "can-mine");
	if (!fact) throw new Error("a result carries exactly one can-mine fact");
	return { kind: KIND[o.result.verdict], canMine: CAN_MINE[fact.state] };
}

/** The parts of ForemanResults the publish job and the read-back call. The publish tests deploy the
 * real compiled contract, so a mismatch here fails them. */
export const foremanResultsAbi = [
	{
		type: "function",
		name: "publish",
		stateMutability: "nonpayable",
		inputs: [
			{
				name: "entries",
				type: "tuple[]",
				components: [
					{ name: "processor", type: "address" },
					{ name: "circuitId", type: "uint256" },
					{ name: "kind", type: "uint8" },
					{ name: "canMine", type: "uint8" },
					{ name: "indexBlock", type: "uint64" },
					{ name: "result", type: "bytes" },
				],
			},
		],
		outputs: [],
	},
	{
		type: "function",
		name: "resultOf",
		stateMutability: "view",
		inputs: [
			{ name: "processor", type: "address" },
			{ name: "circuitId", type: "uint256" },
		],
		outputs: [
			{
				name: "",
				type: "tuple",
				components: [
					{ name: "kind", type: "uint8" },
					{ name: "canMine", type: "uint8" },
					{ name: "indexBlock", type: "uint64" },
					{ name: "resultHash", type: "bytes32" },
				],
			},
		],
	},
	{
		type: "function",
		name: "publisher",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "address" }],
	},
	{
		type: "event",
		name: "Published",
		inputs: [
			{ name: "key", type: "bytes32", indexed: true },
			{ name: "processor", type: "address", indexed: true },
			{ name: "circuitId", type: "uint256", indexed: true },
			{ name: "kind", type: "uint8", indexed: false },
			{ name: "canMine", type: "uint8", indexed: false },
			{ name: "indexBlock", type: "uint64", indexed: false },
			{ name: "resultHash", type: "bytes32", indexed: false },
			{ name: "result", type: "bytes", indexed: false },
		],
	},
	{
		type: "error",
		name: "NotPublisher",
		inputs: [{ name: "caller", type: "address" }],
	},
	{ type: "error", name: "EmptyBatch", inputs: [] },
	{
		type: "error",
		name: "BadEntry",
		inputs: [{ name: "index", type: "uint256" }],
	},
] as const;
