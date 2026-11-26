// ForemanPro, Foreman Pro's payments on the X Layer testnet (contracts/src/ForemanPro.sol;
// docs/decisions/2026-11-26-pro-payments.md): where it is, its ABI and its amount. Shared by the API's
// payment check and the web app's pay page. No Node-only imports: the web app loads this through
// "@foreman/chain-xlayer/pro".

import { type Address, parseAddress } from "@foreman/contract";

/** Deployed by William and confirmed on chain, 26 Nov 2026 (CLAUDE.md, On-chain facts). Testnet only. */
export const FOREMAN_PRO = {
	chainId: 1952,
	address: parseAddress(
		"0x77196c8cd21681c61ec9e150e7f8af4f55f433ac",
		"ForemanPro",
	) as Address,
} as const;

/** One payment: 0.01 test OKB, the contract's PRICE. */
export const PRO_PRICE_WEI = 10_000_000_000_000_000n;

/** The parts of ForemanPro the API and the page use. The API's tests deploy the compiled contract,
 * so a mismatch here fails them. */
export const foremanProAbi = [
	{
		type: "function",
		name: "pay",
		stateMutability: "payable",
		inputs: [{ name: "code", type: "bytes32" }],
		outputs: [],
	},
	{
		type: "function",
		name: "PRICE",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		type: "event",
		name: "Paid",
		inputs: [
			{ name: "code", type: "bytes32", indexed: true },
			{ name: "payer", type: "address", indexed: true },
			{ name: "amount", type: "uint256", indexed: false },
		],
	},
] as const;

/** The 32 bytes a chat's 16-byte code (0x and 32 hex characters) is paid with: padded with zeros. */
export function proCodeWord(code: string): `0x${string}` {
	if (!/^0x[0-9a-f]{32}$/.test(code))
		throw new Error("a Pro code is 16 bytes of lowercase hex");
	return `${code}${"0".repeat(32)}` as `0x${string}`;
}
