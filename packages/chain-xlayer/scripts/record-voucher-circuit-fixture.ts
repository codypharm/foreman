// Records the RIG reads the voucher-circuit tests replay, at X Layer's latest block: voucher #19
// (live on 22 Nov 2026), #3 (redeemed) and #999 (never minted). Read only.
//
//   pnpm --filter @foreman/chain-xlayer record:voucher-circuit

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { readVoucherCircuit } from "../src/index.ts";

const RPC = process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
const blockNumber = await client.getBlockNumber();
const live = await readVoucherCircuit(client, { voucherId: 19n, blockNumber });
if (!live.circuit) throw new Error("voucher #19 isn't live now");
for (const voucherId of [3n, 999n]) {
	const read = await readVoucherCircuit(client, { voucherId, blockNumber });
	if (read.circuit)
		throw new Error(`voucher #${voucherId} names a circuit now`);
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL("../fixtures/xlayer-voucher-circuit.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(blockNumber), recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(
	`#19 → ${live.circuit.processor}/${live.circuit.id}, ${unique.length} calls → ${out.pathname}`,
);
