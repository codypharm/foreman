// Reads every FabX circuit's miner record at the block FabX's history is stored up to, confirms
// each design commitment by its stored event (2026-11-25-fabx-commitment-designer.md) and saves
// them, then reads the block time each unconfirmed commitment claims (2026-11-25-cross-chain-check.md,
// decision 3). Read only on chain.
//
//   pnpm --filter @foreman/index save-fabx-miners

import { readFabxMiners } from "@foreman/chain-xlayer";
import pg from "pg";
import { createPublicClient, http } from "viem";
import {
	fillFabxClaimTimes,
	readFabxState,
	saveFabxMiners,
} from "../src/fabx.ts";
import { migrate } from "../src/index.ts";

const client = createPublicClient({
	transport: http(
		process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech",
		{
			timeout: 30_000,
		},
	),
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	const state = await readFabxState(pool);
	if (!state)
		throw new Error("FabX's history isn't stored: run save-fabx-history first");
	const ids = (
		await pool.query<{ id: string }>(
			"select id from xlayer_circuits order by id",
		)
	).rows.map((r) => BigInt(r.id));
	const read = await readFabxMiners(client, {
		ids,
		blockNumber: state.logsUpToBlock,
	});
	if (!read.complete) throw new Error(read.detail);
	const counts = await saveFabxMiners(pool, read);
	const claimed = await fillFabxClaimTimes(pool, client);
	console.log({
		block: state.logsUpToBlock,
		circuits: ids.length,
		miners: read.miners.length,
		notMiners: read.notMiners,
		...counts,
		claimTimesFilled: claimed.filled,
	});
} finally {
	await pool.end();
}
