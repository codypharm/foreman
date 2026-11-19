// Records the JSON-RPC responses the reader tests replay. Read only: it never sends a
// transaction and needs no key. Re-run it only to add a miner or move to a new block.
//
//   pnpm --filter @foreman/chain-bnb record

import { writeFileSync } from "node:fs";
import { parseHex32 } from "@foreman/contract";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { readMiner, readNetworkState } from "../src/index.ts";

const RPC = "https://bsc-rpc.publicnode.com"; // serves eth_call at past blocks (CLAUDE.md, "RPC notes")
const BLOCK = 134_480_825n;
const KEYS = [
	"0x5f71526db52dc674414b1290a7ce436ab64fd61133b406ca067cbf8d7e4e6cf9", // verified, no bonus
	"0x146fed016999565b17ebee4442c9440fc97dfd312193463c9d54f33113b79fdb", // holds the bonus
	"0x0000000000000000000000000000000000000000000000000000000000000001", // never registered
];

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
for (const hex of KEYS) {
	try {
		await readMiner(client, parseHex32(hex, "key"), { blockNumber: BLOCK });
		console.log(`recorded ${hex}`);
	} catch (error) {
		console.log(
			`recorded ${hex} (reader refused it: ${(error as Error).name})`,
		);
	}
}

await readNetworkState(client, { blockNumber: BLOCK });
console.log("recorded the network state");

const out = new URL(`../fixtures/bnb-${BLOCK}.json`, import.meta.url);
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(BLOCK), recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
