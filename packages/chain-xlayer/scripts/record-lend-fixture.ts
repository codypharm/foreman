// Records the X Layer reads the Lend tests replay, at one block: RIG voucher #16's miner (a voucher
// held by a wallet, not by a TapePool account) and a BNB Chain miner that isn't a voucher. Read only.
//
//   pnpm --filter @foreman/chain-xlayer record:lend

import { writeFileSync } from "node:fs";
import { minerKey } from "@foreman/chain-bnb";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { parseHex32 } from "@foreman/contract";
import { createPublicClient, http } from "viem";
import { rigVoucherAbi } from "../src/abi.ts";
import { RIG_VOUCHER, readLendOffers } from "../src/index.ts";

const RPC = process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";
/** A mining miner on BNB Chain that is not a RIG voucher (chain-bnb's bnb-134480825.json). */
const NOT_A_VOUCHER = process.argv[2];
if (!NOT_A_VOUCHER)
	throw new Error("Pass a BNB Chain miner key that isn't a voucher");

const live = createPublicClient({ transport: http(RPC) });
const blockNumber = await live.getBlockNumber();
const [circuits, , circuitId] = await live.readContract({
	address: RIG_VOUCHER,
	abi: rigVoucherAbi,
	functionName: "rigs",
	args: [16n],
	blockNumber,
});
const voucher16 = minerKey({ processor: circuits, id: circuitId });

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
for (const key of [voucher16, NOT_A_VOUCHER]) {
	const offers = await readLendOffers(client, {
		minerKey: parseHex32(key, "minerKey"),
		blockNumber,
	});
	console.log(
		key,
		offers.map((o) => (o.state === "none" ? o.reason.kind : o.state)),
	);
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL(
	`../fixtures/xlayer-lend-${blockNumber}.json`,
	import.meta.url,
);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(blockNumber), recordedAt: new Date().toISOString(), voucher16, notAVoucher: NOT_A_VOUCHER, calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
