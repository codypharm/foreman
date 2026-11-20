// The daily network samples' first fill (docs/decisions/2026-11-20-growth-rates.md, decision 4):
// loads data/network-daily.json, the history backfilled by
// `pnpm --filter @foreman/chain-bnb backfill`, after checking each sample against the data
// contract. After it, the follow adds each new day. Needs DATABASE_URL.
//
//   pnpm --filter @foreman/index fill-network

import { readFileSync } from "node:fs";
import { parseNetworkState } from "@foreman/contract";
import pg from "pg";
import { migrate, readNetworkDays, saveNetworkDays } from "../src/index.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const file = new URL("../../../data/network-daily.json", import.meta.url);
const { samples } = JSON.parse(readFileSync(file, "utf8")) as {
	samples: unknown[];
};
const states = samples.map((s, i) => parseNetworkState(s, `samples[${i}]`));

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const applied = await migrate(pool);
	if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
	await saveNetworkDays(pool, states);
	const days = await readNetworkDays(pool);
	console.log(
		`${days.length} days saved, ${days[0]?.time} to ${days.at(-1)?.time}`,
	);
} finally {
	await pool.end();
}
