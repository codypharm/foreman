// Records a LIVE TapePool quote, from a LOCAL COPY of X Layer with TapePool's inputs SET BY US, not
// from mainnet. On 21 Nov 2026 no voucher could get a live quote on mainnet: TapePool needs its
// owner's screen pass (48 hours to take effect) and a feed report under 5 minutes old, and only
// voucher #16 (weight 1) had a pass. So on the copy (anvil forked at X Layer block 76,480,869):
//   1. holder 0xC905…f145 created TapePool account 0 (0xBEF5…19be) and deposited voucher #5 alone;
//   2. TapePool's owner 0x19a9…45ba recorded a screen pass for #5 (circuit 12,903 on 0xb102…a14c,
//      task 151) with artifact hash keccak256("foreman local test: not a TapePool screen proof");
//   3. the clock moved forward 172,860 s (48 hours and a minute);
//   4. the LayerZero endpoint delivered TapePool's feed one report for #5, through the receiver's
//      lzReceive from its real BNB Chain peer, with the values TapePool's own BscRigReader reads from
//      BNB Chain block 134,855,566: weight 306, bonus 248, network weight 1,614,273, task 151, mining
//      since 1,788,524,735, pending 107,644,783, held by the vault cell; observed at the copy's time.
// TapePool's code then works out the quote. Checked separately against TapePool's CreditMath in
// Python: 7 days 1.49836122 BEM + 0.00374591 fee; 14 days 2.78730212 BEM + 0.01393652 fee.
//
//   pnpm --filter @foreman/chain-xlayer record:lend-live-fork

import { writeFileSync } from "node:fs";
import { minerKey } from "@foreman/chain-bnb";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import { createPublicClient, http } from "viem";
import { rigVoucherAbi } from "../src/abi.ts";
import { RIG_VOUCHER, readLendOffers } from "../src/index.ts";

const RPC = process.env.XLAYER_FORK_RPC_URL ?? "http://127.0.0.1:8547";

const fork = createPublicClient({ transport: http(RPC) });
if ((await fork.getChainId()) !== 196) throw new Error("Not a copy of X Layer");
const blockNumber = await fork.getBlockNumber();
const [circuits, , circuitId] = await fork.readContract({
	address: RIG_VOUCHER,
	abi: rigVoucherAbi,
	functionName: "rigs",
	args: [5n],
	blockNumber,
});
const voucher5 = minerKey({ processor: circuits, id: circuitId });
const calls: RpcCall[] = [];
const offers = await readLendOffers(recordingClient(RPC, calls), {
	minerKey: voucher5,
	blockNumber,
});
for (const o of offers) {
	console.log(
		o.termDays,
		o.state === "live"
			? `${o.receivedNow.value} + ${o.fee.value} fee`
			: o.reason.kind,
	);
}
const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL(
	`../fixtures/xlayer-lend-fork-live-${blockNumber}.json`,
	import.meta.url,
);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 196, block: String(blockNumber), forkedFrom: "76480869", source: "local copy of X Layer (anvil fork) with TapePool's screen pass and feed report set by Foreman; see scripts/record-lend-live-fork-fixture.ts", recordedAt: new Date().toISOString(), voucher5, calls: unique }, null, "\t")}\n`,
);
console.log(`${unique.length} calls → ${out.pathname}`);
