// Records the netlist reads the FabX tests replay: FabX #24 (140 gates, the same netlist as BNB
// Chain circuit #97), #66 (the same netlist, a stopped miner), #1961 (20 gates, task 48), and
// the only two FabX wrappers with their targets, #6147 → #4206 and #6053 → #269, at X Layer
// block 76,847,895, the block FabX's history was saved up to. Read only.
//
//   pnpm --filter @foreman/index record:fabx-netlists

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { FABX_PROCESSOR } from "@foreman/chain-xlayer";
import { readNetlist } from "@foreman/originality";

const RPC = process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech";
const blockNumber = 76_847_895n;
const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
for (const id of [24n, 66n, 1961n, 6147n, 4206n, 6053n, 269n]) {
	const r = await readNetlist(
		client,
		{ processor: FABX_PROCESSOR, id },
		{ blockNumber },
	);
	if (!r.readable) throw new Error(`#${id}: ${r.detail}`);
}
const out = new URL("../fixtures/fabx-netlists-76847895.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(blockNumber), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(`${calls.length} calls → ${out.pathname}`);
