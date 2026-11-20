// Records the BEM/WBNB pool reads the BEM price tests replay: the price at block 134,739,204, a
// block before the pool existed (it was created at 117,261,607), and a block 3,000 blocks after,
// with under 30 minutes of history. Read only. Needs the archive node.
//
//   pnpm --filter @foreman/chain-bnb record:bem-price

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { readBemPrice } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
const BLOCKS = [134_739_204n, 117_261_606n, 117_264_607n];

const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
for (const blockNumber of BLOCKS) {
	const read = await readBemPrice(client, { blockNumber });
	console.log(
		blockNumber,
		read.available ? `${read.price.bnbPerBem} wei per BEM` : read.reason,
	);
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL("../fixtures/bnb-bem-price.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(BLOCKS[0]), recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
