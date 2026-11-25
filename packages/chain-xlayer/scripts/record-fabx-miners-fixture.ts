// Records the getMiner reads the FabX miner tests replay, at X Layer block 76,847,895 (the FabX
// backfill's last block): #24, #1020, #1648, #1961 (mining), #66 (cooling) and #25 (not a miner).
// Read only.
//
//   pnpm --filter @foreman/chain-xlayer record:fabx-miners

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { FABX_MINER_FIXTURE_IDS, readFabxMiners } from "../src/fabx-miners.ts";

const RPC = process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";
const blockNumber = 76_847_895n;

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
const read = await readFabxMiners(client, { ids: FABX_MINER_FIXTURE_IDS, blockNumber });
if (!read.complete) throw new Error(read.detail);
const out = new URL("../fixtures/fabx-miners-76847895.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(blockNumber), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(`${read.miners.length} miners, ${read.notMiners} not miners, ${calls.length} calls → ${out.pathname}`);
