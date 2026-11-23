// Records the reads the published-result tests replay, on X Layer testnet at its latest block:
// circuit 0xb102…a14c/18387 as published in 0x19a2…af2a, circuit #1 against the same transaction
// (no result for it there), and a transaction X Layer doesn't know. Read only.
//
//   pnpm --filter @foreman/chain-xlayer record:published-result

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { parseAddress, parseHex32 } from "@foreman/contract";
import {
	RESULTS_CONTRACTS,
	ReadBackError,
	readPublishedResult,
	XLAYER_RPC,
} from "../src/results.ts";

const contract = RESULTS_CONTRACTS[1952];
if (!contract) throw new Error("no testnet ForemanResults address");
const X1 = "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c";
const TX = "0x19a27af1539ca8654286e6e5dae73341fa542d76826efdd777a516d4e105af2a";

const calls: RpcCall[] = [];
const client = recordingClient(XLAYER_RPC[1952], calls);
const blockNumber = await client.getBlockNumber();
const q = {
	chainId: 1952 as const,
	contract,
	processor: parseAddress(X1, "processor"),
	tx: parseHex32(TX, "tx"),
	blockNumber,
};
const read = await readPublishedResult(client, { ...q, circuitId: 18387n });
if (!read.current) throw new Error("18387's publish isn't the stored one now");
for (const [circuitId, tx, reason] of [
	[1n, TX, "no-log"],
	[18387n, `0x${"00".repeat(31)}01`, "no-transaction"],
] as const) {
	try {
		await readPublishedResult(client, {
			...q,
			circuitId,
			tx: parseHex32(tx, "tx"),
		});
		throw new Error(`expected ${reason}`);
	} catch (error) {
		if (!(error instanceof ReadBackError) || error.reason !== reason)
			throw error;
	}
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL(
	"../fixtures/xlayer-published-result.json",
	import.meta.url,
);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 1952, block: String(blockNumber), tx: TX, recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(
	`18387: ${read.logged.result.verdict}, current ${read.current}, ${unique.length} calls → ${out.pathname}`,
);
