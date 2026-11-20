// Records what one follow of the daily network samples reads: the follow's block (134,739,204,
// 20 Nov 2026 13:18 UTC) and the network at the first block at or after 00:00 UTC on 19 and
// 20 November 2026. Read only. Needs the archive node.
//
//   pnpm --filter @foreman/chain-bnb record:network-days

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { readNetworkHistory } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
const TO_BLOCK = 134_739_204n;
const DAY = 86_400n;

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
const block = await client.getBlock({ blockNumber: TO_BLOCK });
const lastMidnight = block.timestamp - (block.timestamp % DAY);
const history = await readNetworkHistory(client, {
	from: lastMidnight - DAY,
	to: lastMidnight,
	every: DAY,
});
for (const s of history) {
	console.log(s.readAt.block, s.readAt.time, s.verifiedWeight);
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL(
	"../fixtures/bnb-network-days-134739204.json",
	import.meta.url,
);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(TO_BLOCK), recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
