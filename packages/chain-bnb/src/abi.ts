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
 * written by hand from what was confirmed on 19 and 20 Nov 2026: selectors and event hashes
 * match these signatures exactly, Sold amounts were matched to three sales' transaction values,
 * and every log the market emitted since its first block has one of these eight events
 * (CLAUDE.md "On-chain facts"; docs/notes/2026-11-19-xlayer-market-findings.md;
 * docs/decisions/2026-11-20-market-index.md).
 */
export const CIRCUIT_MARKET =
	"0x6feebbebc07bcb90bd1ac8b0cf9baa4f0ff2b46f" as const;

/** The market's first block with code, found by binary search on eth_getCode, 20 Nov 2026. */
export const CIRCUIT_MARKET_FIRST_BLOCK = 116_708_167n;

/**
 * The market's code: the implementation in its ERC-1967 slot since block 116,709,020, the code
 * every event meaning and `listings(id)` was confirmed against. Any other stops the market follow
 * (CLAUDE.md "On-chain facts"; docs/decisions/2026-11-20-market-admin-events.md).
 */
export const CIRCUIT_MARKET_IMPLEMENTATION =
	"0x725771c38361abef7b844729b978c775f7a83dfb" as const;

/** The market's two upgrades, both before its first listing: the only ones accepted. */
export const CIRCUIT_MARKET_UPGRADES = [
	{
		block: 116_708_167n,
		implementation: "0x437d0a6141079554bbaf0d507ac3070c06576647",
	},
	{ block: 116_709_020n, implementation: CIRCUIT_MARKET_IMPLEMENTATION },
] as const;

/** ERC-1967's implementation slot: keccak256("eip1967.proxy.implementation") − 1. */
export const ERC1967_IMPLEMENTATION_SLOT =
	"0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

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
	{
		name: "Listed",
		type: "event",
		inputs: [
			{ name: "id", type: "uint256", indexed: true },
			{ name: "seller", type: "address", indexed: true },
			{ name: "processor", type: "address", indexed: true },
			{ name: "tokenId", type: "uint256", indexed: false },
			{ name: "price", type: "uint256", indexed: false },
		],
	},
	{
		name: "PriceChanged",
		type: "event",
		inputs: [
			{ name: "id", type: "uint256", indexed: true },
			{ name: "price", type: "uint256", indexed: false },
		],
	},
	{
		// The address and the bool are not interpreted: the listing itself is read again
		name: "Delisted",
		type: "event",
		inputs: [
			{ name: "id", type: "uint256", indexed: true },
			{ name: "by", type: "address", indexed: true },
			{ name: "flag", type: "bool", indexed: false },
		],
	},
	// Admin events of the upgradeable proxy (docs/decisions/2026-11-20-market-admin-events.md)
	{
		name: "Initialized",
		type: "event",
		inputs: [{ name: "version", type: "uint64", indexed: false }],
	},
	{
		name: "OwnershipTransferred",
		type: "event",
		inputs: [
			{ name: "previousOwner", type: "address", indexed: true },
			{ name: "newOwner", type: "address", indexed: true },
		],
	},
	{
		name: "Upgraded",
		type: "event",
		inputs: [{ name: "implementation", type: "address", indexed: true }],
	},
	{
		// The owner taking out the market's fees; not about any listing
		name: "Withdrawn",
		type: "event",
		inputs: [
			{ name: "to", type: "address", indexed: true },
			{ name: "amount", type: "uint256", indexed: false },
		],
	},
] as const;

/** BEM on BNB Smart Chain, 8 decimals. In CLAUDE.md "On-chain facts". */
export const BEM = "0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a" as const;

/** WBNB, 18 decimals: the BEM/WBNB pool's token1. In CLAUDE.md "On-chain facts". */
export const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" as const;

/**
 * The PancakeSwap v3 BEM/WBNB pool, 1% fee: token0 BEM, token1 WBNB. Payback reads its 30-minute
 * average (docs/decisions/2026-11-20-payback-and-bem-price.md). In CLAUDE.md "On-chain facts".
 */
export const BEM_WBNB_POOL =
	"0x28b12792f9d81bd529bc5572434e861c9edbbbc2" as const;

/** The pool's oracle reads, from the PancakeSwap v3 pool interface. */
export const v3PoolAbi = [
	{
		name: "slot0",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [
			{ name: "sqrtPriceX96", type: "uint160" },
			{ name: "tick", type: "int24" },
			{ name: "observationIndex", type: "uint16" },
			{ name: "observationCardinality", type: "uint16" },
			{ name: "observationCardinalityNext", type: "uint16" },
			{ name: "feeProtocol", type: "uint32" },
			{ name: "unlocked", type: "bool" },
		],
	},
	{
		name: "observations",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "index", type: "uint256" }],
		outputs: [
			{ name: "blockTimestamp", type: "uint32" },
			{ name: "tickCumulative", type: "int56" },
			{ name: "secondsPerLiquidityCumulativeX128", type: "uint160" },
			{ name: "initialized", type: "bool" },
		],
	},
	{
		name: "observe",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "secondsAgos", type: "uint32[]" }],
		outputs: [
			{ name: "tickCumulatives", type: "int56[]" },
			{ name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" },
		],
	},
] as const;

export const erc20BalanceOfAbi = [
	{
		name: "balanceOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;
