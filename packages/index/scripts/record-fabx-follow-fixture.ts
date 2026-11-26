// Records the X Layer reads the FabX follow tests replay (src/fabx-follow.test.ts): a real follow
// from block 76,829,600 to 76,829,899 on a test database (reading the netlists of the two circuits
// stored before it too), and the same follow cut at block
// 76,829,809 by a made-up freezing event. Read only on chain; writes only the test database.
//
//   TEST_DATABASE_URL=… pnpm --filter @foreman/index record:fabx-follow

import { writeFileSync } from "node:fs";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { followFabx } from "../src/fabx-follow.ts";
import {
	FABX_FOLLOW_TO,
	fabxFollowDatabase,
	fakeFabxChange,
	withExtraLogs,
} from "../src/testing.ts";

const RPC = process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech";
const calls: RpcCall[] = [];
for (const extra of [[], [fakeFabxChange("Upgraded")]]) {
	const pool = await fabxFollowDatabase();
	try {
		const node = withExtraLogs(recordingClient(RPC, calls), extra);
		const r = await followFabx(
			pool,
			{ client: node, logNodes: [node] },
			{ toBlock: FABX_FOLLOW_TO },
		);
		if (r.followed !== true) throw new Error(`follow: ${JSON.stringify(r)}`);
		console.log(
			`to ${r.toBlock}: new ${r.newCircuits.join(", ")}; frozen at ${r.frozenAtBlock ?? "none"}`,
		);
	} finally {
		await pool.end();
	}
}
const out = new URL("../fixtures/fabx-follow-76829899.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(FABX_FOLLOW_TO), recordedAt: new Date().toISOString(), calls }, null, "\t")}\n`,
);
console.log(`${calls.length} calls → ${out.pathname}`);
