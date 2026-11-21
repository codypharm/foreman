// ForemanResults (contracts/src/ForemanResults.sol): the parts the publish job calls. The tests
// deploy the real compiled contract, so a mismatch here fails them.

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
