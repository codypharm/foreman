// Backfills daily network history from the first full day of mining to today, for the
// valuation's growth rates and the backtests. Needs an archive node: the public one serves
// state only a few hours back. Read only.
//
//   1. Put BNB_ARCHIVE_RPC_URL=... in the repo's .env (gitignored; never commit it)
//   2. pnpm --filter @foreman/chain-bnb backfill
//
// About 90 days × ~25 calls. Writes data/network-daily.json, which is public chain data.

import { mkdirSync, writeFileSync } from "node:fs";
import { serialiseNetworkState } from "@foreman/contract";
import { createPublicClient, http } from "viem";
import { readNetworkHistory } from "../src/index.ts";

const url = process.env.BNB_ARCHIVE_RPC_URL;
if (!url) {
	console.error(
		"BNB_ARCHIVE_RPC_URL is not set. Add an archive RPC URL to the repo's .env (see .env.example).",
	);
	process.exit(1);
}

const DAY = 86_400n;
const EMISSION_START = 1_787_318_132n; // 21 Aug 2026 13:15:32 UTC, PodMining.startTime
const from = EMISSION_START - (EMISSION_START % DAY) + DAY; // 22 Aug 2026 00:00 UTC

// Never log `url`: it carries the archive provider's token
const client = createPublicClient({ transport: http(url, { retryCount: 5 }) });
const head = await client.getBlock().catch((error: unknown) => {
	console.error(String(error).replaceAll(url, "<BNB_ARCHIVE_RPC_URL>"));
	process.exit(1);
});
const to = head.timestamp - (head.timestamp % DAY); // today 00:00 UTC

console.log(`Sampling daily from ${from} to ${to} …`);
const history = await readNetworkHistory(client, {
	from,
	to,
	every: DAY,
}).catch((error: unknown) => {
	// viem puts the request URL in its error messages; strip it so the token never prints
	const message = String(
		error instanceof Error ? (error.stack ?? error.message) : error,
	);
	console.error(message.replaceAll(url, "<BNB_ARCHIVE_RPC_URL>"));
	process.exit(1);
});

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const out = new URL("../data/network-daily.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify(
		{
			chainId: 56,
			source: "PodMining at the first block at or after each 00:00 UTC",
			recordedAt: new Date().toISOString(),
			samples: history.map((s, i) => serialiseNetworkState(s, `samples[${i}]`)),
		},
		null,
		"\t",
	)}\n`,
);
console.log(`${history.length} daily samples → ${out.pathname}`);
