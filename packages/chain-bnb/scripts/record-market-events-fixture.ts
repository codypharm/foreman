// Records every market log in two ranges, for the market event reader's tests: one holding all
// five listing and fee events, one the market's deployment with its admin events. Read only. Needs the archive node: a node without history returns an
// empty list for old blocks (CLAUDE.md, "RPC correction").
//
//   pnpm --filter @foreman/chain-bnb record:market-events

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "../src/fixture.ts";
import { readMarketEvents } from "../src/index.ts";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
const RANGES = [
	// All five listing and fee events
	{ fromBlock: 133_721_700n, toBlock: 133_776_800n },
	// The market's deployment: its admin events and its first listing
	{ fromBlock: 116_708_167n, toBlock: 116_711_900n },
];

for (const range of RANGES) {
	const calls: RpcCall[] = [];
	const events = await readMarketEvents(recordingClient(RPC, calls), range);
	const out = new URL(
		`../fixtures/bnb-market-events-${range.fromBlock}-${range.toBlock}.json`,
		import.meta.url,
	);
	writeFileSync(
		out,
		`${JSON.stringify({ chainId: 56, block: String(range.toBlock), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
	);
	console.log(
		`${events.length} market events, ${calls.length} calls → ${out.pathname}`,
	);
}
