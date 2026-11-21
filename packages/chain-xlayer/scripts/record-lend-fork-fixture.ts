// Records the Lend reads for vouchers in TapePool accounts, from a LOCAL COPY of X Layer, not from
// mainnet: no voucher was deposited with TapePool on 20 Nov 2026. On the copy (anvil forked at
// block 76,433,546), only deposits were made, each by impersonating the voucher's real holder:
//   - holder 0xD7E0…a966: account 0 (0xD453…c1C1), voucher #16 alone;
//   - holder 0xC905…f145: account 0 (0xBEF5…19be), voucher #5 alone; account 1 (0xef16…c0aE),
//     vouchers #4 and #6.
// TapePool's own contracts, data feed and screen are untouched, so every quote is TapePool's real
// answer for that deposit. Read only against the copy.
//
//   anvil --fork-url https://rpc.xlayer.tech --fork-block-number 76433546 --port 8547
//   then, for each account: anvil_impersonateAccount the holder, the factory's create(index), and the
//   voucher's safeTransferFrom(holder, account, id), with cast
//   pnpm --filter @foreman/chain-xlayer record:lend-fork

import { writeFileSync } from "node:fs";
import { minerKey } from "@foreman/chain-bnb";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { createPublicClient, http } from "viem";
import { rigVoucherAbi } from "../src/abi.ts";
import { RIG_VOUCHER, readLendOffers } from "../src/index.ts";

const RPC = process.env.XLAYER_FORK_RPC_URL ?? "http://127.0.0.1:8547";
const VOUCHERS = [16n, 4n];

const fork = createPublicClient({ transport: http(RPC) });
if ((await fork.getChainId()) !== 196) throw new Error("Not a copy of X Layer");
const blockNumber = await fork.getBlockNumber();
const keys: Record<string, string> = {};
const calls: RpcCall[] = [];
const client = recordingClient(RPC, calls);
for (const id of VOUCHERS) {
	const [circuits, , circuitId] = await fork.readContract({
		address: RIG_VOUCHER,
		abi: rigVoucherAbi,
		functionName: "rigs",
		args: [id],
		blockNumber,
	});
	const key = minerKey({ processor: circuits, id: circuitId });
	keys[`voucher${id}`] = key;
	const offers = await readLendOffers(client, { minerKey: key, blockNumber });
	console.log(
		`#${id}`,
		offers.map((o) =>
			o.state === "none"
				? JSON.stringify(o.reason, (_k, v) =>
						typeof v === "bigint" ? `${v}` : v,
					)
				: o.state,
		),
	);
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL(
	`../fixtures/xlayer-lend-fork-${blockNumber}.json`,
	import.meta.url,
);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(blockNumber), forkedFrom: "76433546", source: "local copy of X Layer (anvil fork); deposits only, see scripts/record-lend-fork-fixture.ts", recordedAt: new Date().toISOString(), ...keys, calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
