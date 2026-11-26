// A FabX circuit's can-mine fact (docs/decisions/2026-11-25-fabx-can-mine.md). It comes from
// FabX's miner record as stored with FabX's history, read at the same X Layer block as the copy
// verdict (decision 4), never from a live read. FabX's source isn't verified, so nothing here
// states a meaning of its code beyond the status it reports: no design bonus, no failed test
// vector, and no block a stopped miner can start again from.

import { FABX_MINING } from "@foreman/chain-xlayer";
import { type Originality, parseAddress } from "@foreman/contract";
import type { CanMineRead } from "./can-mine.ts";

/** FabX's miner record as stored: TapeOut's status codes (1 active, 2 revoked, 3 stopped). */
export interface FabxMinerState {
	status: 1 | 2 | 3;
	/** The block it stopped at; set only when stopped. */
	stopBlock: bigint | null;
}

export function fabxCanMine(input: {
	/** null when FabX has no miner record for the circuit. */
	miner: FabxMinerState | null;
	/** Whether its netlist has a REF record. */
	usesRef: boolean;
}): CanMineRead {
	const { miner } = input;
	if (miner === null) {
		return {
			read: true,
			// FabX's processor is eligible; a ProcessorSet event freezes FabX results (decision 2)
			facts: [
				input.usesRef
					? {
							fact: "can-mine",
							state: "cant-mine",
							reasons: [{ reason: "uses-ref" }],
						}
					: { fact: "can-mine", state: "not-started" },
			],
			mining: null,
		};
	}
	const mining: Originality["mining"] = {
		chainId: 196,
		contract: parseAddress(FABX_MINING, "FABX_MINING"),
	};
	switch (miner.status) {
		case 1:
			return {
				read: true,
				facts: [{ fact: "can-mine", state: "mining" }],
				mining,
			};
		case 3:
			if (miner.stopBlock === null) {
				return {
					read: false,
					detail: "a stopped FabX miner has no stored stop block",
				};
			}
			return {
				read: true,
				facts: [
					{
						fact: "can-mine",
						state: "stopped",
						stoppedAt: miner.stopBlock,
						canStartFrom: null,
					},
				],
				mining,
			};
		case 2:
			// No reason Foreman can show: FabX's test vectors aren't read (decision 3)
			return {
				read: false,
				detail:
					"FabX reports this miner revoked; Foreman doesn't read FabX's test vectors",
			};
	}
}
