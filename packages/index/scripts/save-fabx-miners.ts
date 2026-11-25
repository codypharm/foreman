// Reads every FabX circuit's miner record at the block FabX's history is stored up to, confirms
// each design commitment by its stored event (2026-11-25-fabx-commitment-designer.md) and saves
// them. Read only on chain.
//
//   pnpm --filter @foreman/index save-fabx-miners

import { readFabxMiners } from "@foreman/chain-xlayer";
import pg from "pg";
import { createPublicClient, http } from "viem";
import { readFabxState, saveFabxMiners } from "../src/fabx.ts";

const client = createPublicClient({
	transport: http(process.env.XLAYER_RPC_URL || "https://rpc.xlayer.tech", { timeout: 30_000 }),
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
	const state = await readFabxState(pool);
	if (!state) throw new Error("FabX's history isn't stored: run save-fabx-history first");
	const ids = (await pool.query<{ id: string }>("select id from xlayer_circuits order by id")).rows.map((r) => BigInt(r.id));
	const read = await readFabxMiners(client, { ids, blockNumber: state.logsUpToBlock });
	if (!read.complete) throw new Error(read.detail);
	const counts = await saveFabxMiners(pool, read);
	console.log({ block: state.logsUpToBlock, circuits: ids.length, miners: read.miners.length, notMiners: read.notMiners, ...counts });
} finally {
	await pool.end();
}
