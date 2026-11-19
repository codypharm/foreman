// ABI fragments for the reads the BNB reader makes. Generated from the verified source on
// Sourcify (PodMining.sol, logic contract 0xa3dbe873da37cd4e4a13c7cef23a7db6ca60f898),
// not typed by hand. Only view functions: the reader never writes.

/** PoD mining contract (proxy) on BNB Smart Chain. In CLAUDE.md "On-chain facts". */
export const POD_MINING = "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46" as const;

export const podMiningAbi = [
	{
		name: "getMiner",
		type: "function",
		inputs: [
			{
				name: "key",
				type: "bytes32",
			},
		],
		outputs: [
			{
				name: "",
				type: "tuple",
				components: [
					{
						name: "circuits",
						type: "address",
					},
					{
						name: "circuitId",
						type: "uint64",
					},
					{
						name: "taskId",
						type: "uint32",
					},
					{
						name: "gateCount",
						type: "uint32",
					},
					{
						name: "stateCount",
						type: "uint32",
					},
					{
						name: "depth",
						type: "uint32",
					},
					{
						name: "area",
						type: "uint64",
					},
					{
						name: "mult",
						type: "uint32",
					},
					{
						name: "since",
						type: "uint64",
					},
					{
						name: "status",
						type: "uint8",
					},
					{
						name: "registrant",
						type: "address",
					},
					{
						name: "nandBurn",
						type: "uint32",
					},
					{
						name: "latchBurn",
						type: "uint32",
					},
					{
						name: "bstar",
						type: "uint64",
					},
					{
						name: "bonus",
						type: "uint64",
					},
					{
						name: "optimal",
						type: "bool",
					},
					{
						name: "commitBlock",
						type: "uint64",
					},
					{
						name: "firstUnusedId",
						type: "uint64",
					},
					{
						name: "stopBlock",
						type: "uint64",
					},
					{
						name: "verifWeight",
						type: "uint128",
					},
					{
						name: "unverWeight",
						type: "uint128",
					},
					{
						name: "debt",
						type: "uint256",
					},
				],
			},
		],
		stateMutability: "view",
	},
	{
		name: "totalVerifWeight",
		type: "function",
		inputs: [],
		outputs: [
			{
				name: "",
				type: "uint256",
			},
		],
		stateMutability: "view",
	},
	{
		name: "totalUnverWeight",
		type: "function",
		inputs: [],
		outputs: [
			{
				name: "",
				type: "uint256",
			},
		],
		stateMutability: "view",
	},
	{
		name: "minerCount",
		type: "function",
		inputs: [],
		outputs: [
			{
				name: "",
				type: "uint256",
			},
		],
		stateMutability: "view",
	},
	{
		name: "verifMinerCount",
		type: "function",
		inputs: [],
		outputs: [
			{
				name: "",
				type: "uint256",
			},
		],
		stateMutability: "view",
	},
] as const;

/** ERC-721 ownerOf: every processor contract is the miners' NFT. */
export const erc721OwnerOfAbi = [
	{
		name: "ownerOf",
		type: "function",
		inputs: [{ name: "tokenId", type: "uint256" }],
		outputs: [{ name: "", type: "address" }],
		stateMutability: "view",
	},
] as const;

/**
 * TapeOut's circuit market on BNB Smart Chain. Its source is NOT verified, so this ABI is
 * written by hand from what was confirmed on 19 Nov 2026: selectors and event hashes match
 * these signatures exactly, and Sold amounts were matched to three sales' transaction values
 * (CLAUDE.md "On-chain facts"; docs/notes/2026-11-19-xlayer-market-findings.md).
 */
export const CIRCUIT_MARKET =
	"0x6feebbebc07bcb90bd1ac8b0cf9baa4f0ff2b46f" as const;

export const circuitMarketAbi = [
	{
		name: "listings",
		type: "function",
		inputs: [{ name: "id", type: "uint256" }],
		outputs: [
			{ name: "seller", type: "address" },
			{ name: "processor", type: "address" },
			{ name: "price", type: "uint256" },
			{ name: "feeBps", type: "uint256" },
			{ name: "tokenId", type: "uint256" },
		],
		stateMutability: "view",
	},
	{
		// Returns the latest listing id already used, not the next free one
		name: "nextListingId",
		type: "function",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
		stateMutability: "view",
	},
	{
		name: "Sold",
		type: "event",
		inputs: [
			{ name: "id", type: "uint256", indexed: true },
			{ name: "buyer", type: "address", indexed: true },
			{ name: "processor", type: "address", indexed: true },
			{ name: "tokenId", type: "uint256", indexed: false },
			{ name: "sellerProceeds", type: "uint256", indexed: false },
			{ name: "fee", type: "uint256", indexed: false },
		],
	},
] as const;
