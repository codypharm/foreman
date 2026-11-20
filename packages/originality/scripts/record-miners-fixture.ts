// Records the JSON-RPC responses the miner-start tests replay: every Started event on the
// mining contract in blocks 117,268,000 to 117,271,000, which include a real restart
// (0xb102…/647 started at 117,268,905 and again at 117,270,988), and getMiner for each miner
// there at the index's block, 134,690,552.
//
// Read only: eth_getLogs and eth_call. Needs BNB_ARCHIVE_RPC_URL (.env).
//
//   pnpm --filter @foreman/originality record:miners

import { writeFileSync } from "node:fs";
import { podMiningAbi } from "@foreman/chain-bnb";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { type Hex, numberToHex } from "viem";
import { POD_MINING, STARTED } from "../src/scan-miner-starts.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");

const FROM = 117_268_000n;
const TO = 117_271_000n;
const AT = 134_690_552n;

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);

const logs = (await client.request({
	method: "eth_getLogs",
	params: [
		{
			address: POD_MINING,
			topics: [STARTED],
			fromBlock: numberToHex(FROM),
			toBlock: numberToHex(TO),
		},
	],
})) as { topics: Hex[] }[];
const keys = [...new Set(logs.map((l) => l.topics[1] as Hex))];
for (const key of keys) {
	await client.readContract({
		address: POD_MINING,
		abi: podMiningAbi,
		functionName: "getMiner",
		args: [key],
		blockNumber: AT,
	});
}

const out = new URL(
	`../fixtures/bnb-miner-starts-${FROM}-${TO}.json`,
	import.meta.url,
);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(AT), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(
	`${logs.length} starts, ${keys.length} miners, ${calls.length} calls → ${out.pathname}`,
);
