// Lend offers from TapePool (docs/decisions/2026-11-20-lend-from-tapepool.md): one per term, each
// TapePool's own quote or "none" with its reason. Read only: Foreman never borrows or deposits.
//
// A live offer is TapePool's own quote for a voucher alone in its account: the largest advance, its
// fee and the OKB operating fee. No voucher had one on mainnet on 20 Nov 2026, so the live branch is
// tested on a local copy of X Layer (scripts/record-lend-live-fork-fixture.ts).

import { ChainReadError, minerKey } from "@foreman/chain-bnb";
import {
	type Address,
	type ChainRead,
	type Hex32,
	type LendNoneReason,
	type Offer,
	parseAddress,
	parseOffer,
	serialiseOffer,
	TAPEPOOL_REASONS,
} from "@foreman/contract";
import { getAddress, type PublicClient } from "viem";
import {
	RIG_VOUCHER,
	rigVoucherAbi,
	TAPEPOOL_FACTORY,
	TAPEPOOL_LENS,
	tapeLensAbi,
	tapePoolAccountAbi,
	tapePoolFactoryAbi,
} from "./abi.ts";

export type LendOffer = Extract<Offer, { option: "lend" }>;

const TERMS = [7, 14] as const;

/** The RIG voucher that stands for a miner held in the rig vault, and who holds it. */
export interface Voucher {
	voucherId: bigint;
	holder: Address;
	readAt: ChainRead;
}

/** The voucher naming this miner at one X Layer block, or null when no voucher names it. */
export async function readVoucher(
	client: PublicClient,
	at: { minerKey: Hex32; blockNumber: bigint },
): Promise<Voucher | null> {
	const { blockNumber } = at;
	const block = await client.getBlock({ blockNumber });
	const voucherId = await findVoucher(client, at.minerKey, blockNumber);
	if (voucherId === null) return null;
	const holder = await client.readContract({
		address: RIG_VOUCHER,
		abi: rigVoucherAbi,
		functionName: "ownerOf",
		args: [voucherId],
		blockNumber,
	});
	return {
		voucherId,
		holder: parseAddress(holder.toLowerCase(), "RIG.ownerOf"),
		readAt: { chainId: 196, block: block.number, time: block.timestamp },
	};
}

/**
 * The Lend offers for a miner at one X Layer block: 7 days, then 14. Pass `voucher` when it was
 * already read at this block, to save finding it again.
 */
export async function readLendOffers(
	client: PublicClient,
	at: { minerKey: Hex32; blockNumber: bigint; voucher?: Voucher | null },
): Promise<LendOffer[]> {
	const { blockNumber } = at;
	if (at.voucher && at.voucher.readAt.block !== blockNumber) {
		throw new ChainReadError(
			`The voucher was read at block ${at.voucher.readAt.block}, the Lend offers at ${blockNumber}`,
		);
	}
	const block = await client.getBlock({ blockNumber });
	const none = (reason: LendNoneReason) =>
		TERMS.map((termDays) =>
			checked({
				option: "lend",
				minerKey: at.minerKey,
				termDays,
				state: "none",
				checkedAt: block.timestamp,
				reason,
			}),
		);

	const voucher =
		at.voucher === undefined
			? await readVoucher(client, { minerKey: at.minerKey, blockNumber })
			: at.voucher;
	if (voucher === null) return none({ kind: "not-a-voucher" });
	const { voucherId } = voucher;
	// Checksummed, as the node returned it, so calls to the holder's account read as before
	const holder = getAddress(voucher.holder);

	const deposited = await client.readContract({
		address: TAPEPOOL_FACTORY,
		abi: tapePoolFactoryAbi,
		functionName: "isAgent",
		args: [holder],
		blockNumber,
	});
	if (!deposited) return none({ kind: "not-deposited", voucherId });

	const account = holder;
	// Only the live factory's pool: an account always lends from its factory's pool (ADR decision 5)
	const [factoryPool, accountPool] = await Promise.all([
		client.readContract({
			address: TAPEPOOL_FACTORY,
			abi: tapePoolFactoryAbi,
			functionName: "pool",
			blockNumber,
		}),
		client.readContract({
			address: account,
			abi: tapePoolAccountAbi,
			functionName: "pool",
			blockNumber,
		}),
	]);
	if (factoryPool.toLowerCase() !== accountPool.toLowerCase()) {
		throw new ChainReadError(
			`TapePool account ${account} lends from ${accountPool}, not the factory's pool ${factoryPool}`,
		);
	}

	const collateral = await client.readContract({
		address: TAPEPOOL_LENS,
		abi: tapeLensAbi,
		functionName: "collateralOf",
		args: [account],
		blockNumber,
	});
	if (!collateral.includes(voucherId)) {
		throw new ChainReadError(
			`RIG voucher #${voucherId} is held by TapePool account ${account} but isn't in its collateral (${collateral.join(", ")})`,
		);
	}
	if (collateral.length > 1) {
		return none({
			kind: "shared-account",
			voucherId,
			vouchers: collateral.length,
		});
	}

	const offers: LendOffer[] = [];
	for (const termDays of TERMS) {
		const quote = await client.readContract({
			address: TAPEPOOL_LENS,
			abi: tapeLensAbi,
			functionName: "quote",
			args: [account, termDays === 7 ? 0 : 1],
			blockNumber,
		});
		if (quote.reason === 0) {
			offers.push(
				checked({
					option: "lend",
					minerKey: at.minerKey,
					termDays,
					state: "live",
					venue: "tapepool",
					readAt: { chainId: 196, block: block.number, time: block.timestamp },
					voucherId,
					receivedNow: { currency: "BEM", value: quote.maxPrincipal },
					fee: { currency: "BEM", value: quote.fee },
					opsFee: { currency: "OKB", value: quote.opsFee },
					repayment: "from-output-until-paid",
				}),
			);
			continue;
		}
		const tapepool = TAPEPOOL_REASONS[quote.reason - 1];
		if (!tapepool) {
			throw new ChainReadError(
				`TapePool's quote gave reason ${quote.reason}, outside its codes 0 to ${TAPEPOOL_REASONS.length}`,
			);
		}
		offers.push(
			checked({
				option: "lend",
				minerKey: at.minerKey,
				termDays,
				state: "none",
				checkedAt: block.timestamp,
				reason: { kind: "declined", voucherId, tapepool },
			}),
		);
	}
	return offers;
}

/** The live voucher whose miner has this key, or null. The voucher has no lookup by key. */
async function findVoucher(
	client: PublicClient,
	key: Hex32,
	blockNumber: bigint,
): Promise<bigint | null> {
	const rig = {
		address: RIG_VOUCHER,
		abi: rigVoucherAbi,
		blockNumber,
	} as const;
	const supply = await client.readContract({
		...rig,
		functionName: "totalSupply",
	});
	for (let i = 0n; i < supply; i++) {
		const id = await client.readContract({
			...rig,
			functionName: "tokenByIndex",
			args: [i],
		});
		const [circuits, , circuitId] = await client.readContract({
			...rig,
			functionName: "rigs",
			args: [id],
		});
		if (minerKey({ processor: circuits, id: circuitId }) === key) return id;
	}
	return null;
}

/** Through the contract's own parser, so a reader never returns what the app would refuse. */
function checked(offer: LendOffer): LendOffer {
	return parseOffer(serialiseOffer(offer, "lend"), "lend") as LendOffer;
}
