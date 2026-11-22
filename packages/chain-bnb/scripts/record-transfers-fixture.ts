// Records the circuit NFTs' Transfer events on the two eligible processors in one 50,000-block
// window, and each circuit's ownerOf at the window's last block, for the transfer scan's tests
// (docs/decisions/2026-11-22-wallet-miners.md). Read only. Needs the archive node: a node without
// history returns an empty list for old blocks (CLAUDE.md, "RPC correction").
//
//   pnpm --filter @foreman/chain-bnb record:transfers

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { scanCircuitTransfers } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
const RANGE = { fromBlock: 135_080_000n, toBlock: 135_129_999n };
const ownerOfAbi = [
	{
		name: "ownerOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "id", type: "uint256" }],
		outputs: [{ name: "", type: "address" }],
	},
] as const;

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
const scan = await scanCircuitTransfers(client, RANGE);
if (!scan.complete) throw new Error(scan.detail);
const circuits = new Map(
	scan.transfers.map((t) => [`${t.processor}/${t.id}`, t]),
);
for (const t of circuits.values()) {
	await client.readContract({
		address: t.processor,
		abi: ownerOfAbi,
		functionName: "ownerOf",
		args: [t.id],
		blockNumber: RANGE.toBlock,
	});
}
const out = new URL(
	`../fixtures/bnb-transfers-${RANGE.fromBlock}-${RANGE.toBlock}.json`,
	import.meta.url,
);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(RANGE.toBlock), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(
	`${scan.transfers.length} transfers of ${circuits.size} circuits, ${calls.length} calls → ${out.pathname}`,
);
