// Saves FabX's backfilled logs (data/fabx-logs-<to>.jsonl, from
// `pnpm --filter @foreman/chain-xlayer backfill:fabx-logs`) into the FabX tables, then prints
// the counts and the state. Run once; saving again changes nothing.
//
//   pnpm --filter @foreman/index save-fabx-history <to-block>

import { readFileSync } from "node:fs";
import { decodeFabxLogs, FABX_FIRST_BLOCK, type XLayerLog } from "@foreman/chain-xlayer";
import pg from "pg";
import { migrate } from "../src/migrate.ts";
import { saveFabxHistory } from "../src/fabx.ts";

/**
 * The code reviewed on 25 Nov 2026 (selectors and events compared with TapeOut's PodMining), in
 * place since block 73,517,253 (docs/notes/2026-11-25-fabx-history.md). A freezing change after
 * that block freezes FabX results (2026-11-25-fabx-copy-check.md, decision 6).
 */
const REVIEWED = { implementation: "0x90681776c2d6be4676d83fa8fef22836b5dbbeeb", atBlock: 73_517_253n };

const to = BigInt(process.argv[2] ?? "");
const logs: XLayerLog[] = [];
const pieces = new Set<string>();
for (const line of readFileSync(`../../data/fabx-logs-${to}.jsonl`, "utf8").split("\n")) {
	if (!line) continue;
	const piece = JSON.parse(line);
	if (pieces.has(piece.fromBlock)) continue;
	pieces.add(piece.fromBlock);
	for (const l of piece.logs)
		logs.push({
			...l,
			blockNumber: BigInt(l.blockNumber),
			...(l.blockTimestamp === undefined ? {} : { blockTimestamp: BigInt(l.blockTimestamp) }),
		});
}
const expected = Number((to - FABX_FIRST_BLOCK) / 100n) + 1;
if (pieces.size !== expected) throw new Error(`${pieces.size} pieces in the file, ${expected} expected: run the backfill again`);

const history = decodeFabxLogs(logs);
if (!history.ok) throw new Error(history.detail);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
	await migrate(pool);
	const state = await saveFabxHistory(pool, { fromBlock: FABX_FIRST_BLOCK, toBlock: to, history }, REVIEWED);
	const n = async (t: string) => (await pool.query(`select count(*) from ${t}`)).rows[0].count;
	console.log({
		circuits: await n("xlayer_circuits"),
		commitments: await n("fabx_design_commitments"),
		starts: await n("fabx_starts"),
		contractEvents: await n("fabx_contract_events"),
		state,
	});
} finally {
	await pool.end();
}
