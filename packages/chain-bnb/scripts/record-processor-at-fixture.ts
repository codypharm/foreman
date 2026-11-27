// Records the factory reads the processor-place tests replay, at BNB Chain's latest block: place 30
// (the TapeOut processor, 0xb102…a14c, on 27 Nov 2026), place 0 and a place past the count. Read only.
//
//   pnpm --filter @foreman/chain-bnb record:processor-at

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { readProcessorAt } from "../src/index.ts";

const RPC = process.env.BNB_RPC_URL ?? "https://bsc-rpc.publicnode.com";

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
const blockNumber = await client.getBlockNumber();
for (const position of [30n, 0n, 1_000_000n]) {
	console.log(
		position,
		await readProcessorAt(client, { position, blockNumber }),
	);
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL("../fixtures/bnb-processor-at.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(blockNumber), recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
