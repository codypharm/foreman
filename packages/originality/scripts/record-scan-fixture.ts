// Records the JSON-RPC responses the tape-out scan tests replay: every processor the factory
// listed and every TapedOut event from the factory's creation to an early block, when there
// were 32 processors and 95 circuits (docs/decisions/2026-11-20-circuit-index.md).
//
// Read only: eth_call and eth_getLogs. Needs BNB_ARCHIVE_RPC_URL (.env).
//
//   pnpm --filter @foreman/originality record:scan
//
// The calls match what scanTapeOuts makes, so the replay answers them: eth_call through viem's
// readContract, and eth_getLogs as { topics, fromBlock, toBlock } in that key order.

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { numberToHex } from "viem";
import {
	FACTORY,
	FACTORY_FIRST_BLOCK,
	factoryAbi,
	LOG_SPAN,
	processorAbi,
	TAPED_OUT,
} from "../src/scan-tape-outs.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");

const FROM = FACTORY_FIRST_BLOCK;
const TO = 116_150_000n;

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);

const count = await client.readContract({
	address: FACTORY,
	abi: factoryAbi,
	functionName: "cpuCount",
	blockNumber: TO,
});
for (let i = 0n; i < count; i++) {
	const processor = await client.readContract({
		address: FACTORY,
		abi: factoryAbi,
		functionName: "cpuAt",
		args: [i],
		blockNumber: TO,
	});
	await client.readContract({
		address: processor,
		abi: processorAbi,
		functionName: "nextId",
		blockNumber: TO,
	});
}
for (let from = FROM; from <= TO; from += LOG_SPAN) {
	const to = from + LOG_SPAN - 1n < TO ? from + LOG_SPAN - 1n : TO;
	await client.request({
		method: "eth_getLogs",
		params: [
			{
				topics: [TAPED_OUT],
				fromBlock: numberToHex(from),
				toBlock: numberToHex(to),
			},
		],
	});
}

const out = new URL(`../fixtures/bnb-tape-outs-${TO}.json`, import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(TO), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(`${count} processors, ${calls.length} calls → ${out.pathname}`);
