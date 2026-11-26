// Records the X Layer block headers the FabX claimed-time tests replay: the blocks FabX names as
// design commitments for #302 (73,053,971), #3046 (73,050,416) and #1020 (73,115,351), none of
// them confirmed by a DesignCommitted event (2026-11-25-cross-chain-check.md, decision 3). Read only.
//
//   pnpm --filter @foreman/index record:fabx-claim-times

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";

const RPC = process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech";
const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
for (const blockNumber of [73_053_971n, 73_050_416n, 73_115_351n]) {
	const b = await client.getBlock({ blockNumber });
	console.log(`block ${blockNumber}: ${b.timestamp}`);
}
const out = new URL("../fixtures/fabx-claim-times.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: "73115351", recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(`${calls.length} calls → ${out.pathname}`);
