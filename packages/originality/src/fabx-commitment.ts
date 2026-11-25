// Whether a FabX miner's design commitment is confirmed by FabX's own event history
// (docs/decisions/2026-11-25-fabx-copy-check.md, decision 5, as refined by
// 2026-11-25-fabx-commitment-designer.md). FabX's contract is upgradeable and its storage can be
// rewritten, so the commitment block it reports counts only when the event that made it is in
// that block. Never guessed: no matching event is "unconfirmed".

import type { Address } from "viem";

export interface CommitmentEvent {
	/** Where the event is in the chain. */
	at: { block: bigint; tx: number; log: number };
	/** Its block's time, Unix seconds. */
	time: bigint;
	designer: Address;
	circuits: Address;
	/** The event's own block field. A migrated event claims an earlier block than its own. */
	claimedBlock: bigint;
	firstUnusedId: bigint;
}

/** What FabX's getMiner reports about a miner's commitment. */
export interface MinerCommitment {
	processor: Address;
	id: bigint;
	/** 0 when the miner started without a commitment. */
	commitBlock: bigint;
	firstUnusedId: bigint;
}

export type CommitmentCheck =
	| { status: "none" }
	| { status: "confirmed"; by: CommitmentEvent }
	| { status: "unconfirmed"; reason: string };

/**
 * @param events the commitment events emitted in the miner's commitment block (others are ignored)
 * @param starters every address that started this circuit, from FabX's Started events
 */
export function confirmCommitment(
	miner: MinerCommitment,
	events: readonly CommitmentEvent[],
	starters: ReadonlySet<Address>,
): CommitmentCheck {
	if (miner.commitBlock === 0n) return { status: "none" };
	const processor = miner.processor.toLowerCase();
	const by = events.find(
		(e) =>
			e.at.block === miner.commitBlock &&
			e.claimedBlock === e.at.block &&
			e.circuits.toLowerCase() === processor &&
			e.firstUnusedId === miner.firstUnusedId &&
			e.firstUnusedId <= miner.id &&
			starters.has(e.designer.toLowerCase() as Address),
	);
	if (by) return { status: "confirmed", by };
	return {
		status: "unconfirmed",
		reason: `no commitment event in block ${miner.commitBlock} by an address that started this circuit, with its firstUnusedId`,
	};
}
