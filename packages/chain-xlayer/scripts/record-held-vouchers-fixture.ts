// Records the RIG reads the held-voucher tests replay, at X Layer's latest block: voucher #19's
// holder (2 vouchers on 22 Nov 2026) and Foreman's publisher wallet, which holds none, plus each
// voucher's ownerOf. Read only.
//
//   pnpm --filter @foreman/chain-xlayer record:held-vouchers

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { parseAddress } from "@foreman/contract";
import { createPublicClient, http } from "viem";
import { rigVoucherAbi } from "../src/abi.ts";
import { RIG_VOUCHER, readHeldVouchers } from "../src/index.ts";

const RPC = process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";
/** Foreman's publisher wallet (CLAUDE.md, On-chain facts): holds no voucher. */
const NO_VOUCHERS = parseAddress(
	"0x2ef2fed3f9b3d5385499008051031320b1fb49ef",
	"publisher",
);

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
// Through the recording client, so a replay can answer the latest-block read as the wallet page makes it
const blockNumber = await client.getBlockNumber();
const live = createPublicClient({ transport: http(RPC) });
const rig = { address: RIG_VOUCHER, abi: rigVoucherAbi, blockNumber } as const;
const holder = parseAddress(
	(
		await live.readContract({ ...rig, functionName: "ownerOf", args: [19n] })
	).toLowerCase(),
	"RIG.ownerOf",
);

const held = await readHeldVouchers(client, { holder, blockNumber });
for (const v of held.vouchers) {
	await client.readContract({
		...rig,
		functionName: "ownerOf",
		args: [v.voucherId],
	});
}
const none = await readHeldVouchers(client, {
	holder: NO_VOUCHERS,
	blockNumber,
});
if (none.vouchers.length !== 0)
	throw new Error("the publisher wallet holds a voucher now");
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL("../fixtures/xlayer-held-vouchers.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(blockNumber), recordedAt: new Date().toISOString(), holder, noVouchers: NO_VOUCHERS, calls: unique }, null, "\t")}\n`,
);
console.log(
	`${held.vouchers.length} vouchers (${held.vouchers.map((v) => `#${v.voucherId}`).join(", ")}), ${unique.length} calls → ${out.pathname}`,
);
