// Records the responses the history tests replay: network state every 15 minutes over the
// last hour. The public node serves state only ~10,000 blocks back, so this window stays
// inside it and needs no archive key. Read only.
//
//   pnpm --filter @foreman/chain-bnb record:history

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { blockAtOrAfter, readNetworkHistory } from "../src/index.ts";

const RPC = "https://bsc-rpc.publicnode.com";
const EVERY = 900n; // 15 minutes

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
const head = await client.getBlock();
const to = head.timestamp - (head.timestamp % EVERY) - EVERY; // a whole quarter hour, safely in the past
const from = to - 3n * EVERY;

const history = await readNetworkHistory(client, { from, to, every: EVERY });
const times: string[] = [];
for (let time = from; time <= to; time += EVERY) {
	times.push(String(time));
	// The tests also check the block just before each one found
	const found = await blockAtOrAfter(client, time);
	await client.getBlock({ blockNumber: found - 1n });
}
console.log(`recorded ${history.length} samples from ${from} to ${to}`);

const out = new URL("../fixtures/bnb-history.json", import.meta.url);
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
writeFileSync(
	out,
	`${JSON.stringify(
		{
			chainId: 56,
			block: String(head.number),
			recordedAt: new Date().toISOString(),
			times,
			window: { from: String(from), to: String(to), every: String(EVERY) },
			calls: unique,
		},
		null,
		"\t",
	)}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
