// A wallet's miners and their copy alerts (docs/data-contract.md, WalletMiners;
// docs/decisions/2026-11-21-api-endpoints.md, decisions 5 and 6; 2026-11-22-wallet-miners.md):
// the started miners whose NFT the wallet holds at the owner follow's block, plus the RIG vouchers it
// holds on X Layer (read live), each with its stored result and an alert listing the open listings
// of later identical circuits. A page is whole or an error, and it goes through the contract's own
// parser before it is returned. Facts, never accusations.

import { PROCESSOR_MULTIPLIERS } from "@foreman/chain-bnb";
import { readHeldVouchers } from "@foreman/chain-xlayer";
import {
	type Address,
	type ApiError,
	type BnbRead,
	type CircuitRef,
	type CopyAlert,
	type CopyListing,
	designedEarlier,
	JUST_LISTED_SECONDS,
	parseWalletMiners,
	type StoredCheck,
	serialiseWalletMiners,
	type WalletMiner,
	type WalletMiners,
} from "@foreman/contract";
import {
	type IndexedMiner,
	marketRead,
	readCircuitRef,
	readHeldMiners,
	readIndexedMiner,
	readOpenListings,
	readStoredResult,
} from "@foreman/index";
import { ORIGINALITY_RULES } from "@foreman/originality";
import type pg from "pg";
import type { PublicClient } from "viem";
import { NOT_CHECKED } from "./listings-page.ts";

/** Shown on screen with every alert. */
export const COPY_ALERT_RULE = `Open listings of later identical circuits, at or above ${ORIGINALITY_RULES.sizeFloor} gates, not listed by this wallet`;

export type WalletRead =
	| { ok: true; page: WalletMiners }
	| { ok: false; error: ApiError };

export async function readWalletMiners(
	deps: {
		pool: pg.Pool;
		/** X Layer mainnet (196), where RIG vouchers live. */
		xlayer: PublicClient;
	},
	wallet: Address,
): Promise<WalletRead> {
	const { pool } = deps;
	let at: BnbRead;
	let held: Awaited<ReturnType<typeof readHeldMiners>>;
	try {
		[at, held] = await Promise.all([
			marketRead(pool),
			readHeldMiners(pool, wallet),
		]);
	} catch (error) {
		return notReady(plain(error));
	}
	if (held.upToBlock === null) {
		return notReady("The owners haven't been followed yet: run the follow");
	}

	let vouchers: Awaited<ReturnType<typeof readHeldVouchers>>;
	try {
		const blockNumber = await deps.xlayer.getBlockNumber();
		vouchers = await readHeldVouchers(deps.xlayer, {
			holder: wallet,
			blockNumber,
		});
	} catch (error) {
		return {
			ok: false,
			error: {
				error: "read-failed",
				detail: `Couldn't read the RIG vouchers this wallet holds on X Layer: ${short(error)}`,
			},
		};
	}

	const entries: { miner: IndexedMiner; heldAs: WalletMiner["heldAs"] }[] =
		held.miners.map((m) => ({
			miner: m,
			heldAs: { kind: "nft", ownerSince: m.ownerSince },
		}));
	try {
		for (const v of vouchers.vouchers) {
			const miner = await readIndexedMiner(pool, v.circuit);
			if (!miner) {
				return notReady(
					`RIG voucher #${v.voucherId}'s miner (circuit #${v.circuit.id} on ${v.circuit.processor}) isn't in the index yet: run the follow`,
				);
			}
			entries.push({
				miner,
				heldAs: { kind: "voucher", voucherId: v.voucherId },
			});
		}

		const miners: WalletMiner[] = [];
		for (const e of entries) {
			miners.push(await walletMiner(pool, wallet, at, e.miner, e.heldAs));
		}
		miners.sort(walletOrder);
		const page: WalletMiners = {
			wallet,
			owners: { chainId: 56, upToBlock: held.upToBlock },
			vouchers: vouchers.readAt,
			market: { venue: "bnb-market", upTo: at },
			miners,
		};
		return {
			ok: true,
			page: parseWalletMiners(serialiseWalletMiners(page, "page"), "page"),
		};
	} catch (error) {
		return { ok: false, error: { error: "read-failed", detail: plain(error) } };
	}
}

async function walletMiner(
	pool: pg.Pool,
	wallet: Address,
	at: BnbRead,
	miner: IndexedMiner,
	heldAs: WalletMiner["heldAs"],
): Promise<WalletMiner> {
	const [circuit, stored] = await Promise.all([
		readCircuitRef(pool, miner.circuit),
		readStoredResult(pool, miner.circuit),
	]);
	if (!circuit) {
		throw new Error(
			`Circuit #${miner.circuit.id} on ${miner.circuit.processor} isn't in the index`,
		);
	}
	const check: StoredCheck = stored
		? { state: "checked", originality: stored.originality }
		: { state: "not-checked", detail: NOT_CHECKED };
	return {
		circuit,
		minerKey: miner.key,
		heldAs,
		multiplier: PROCESSOR_MULTIPLIERS[miner.circuit.processor] ?? 0,
		check,
		alert: await copyAlert(pool, wallet, at, circuit, check, miner.gateCount),
	};
}

/**
 * The open listings of later identical circuits, newest first, or null when there are none. Only a
 * checked design at or above the size floor can have one: a design below the floor never raises an
 * alert, even when it has no earlier copy.
 */
async function copyAlert(
	pool: pg.Pool,
	wallet: Address,
	at: BnbRead,
	circuit: CircuitRef,
	check: StoredCheck,
	gateCount: number | null,
): Promise<CopyAlert | null> {
	if (check.state !== "checked") return null;
	const result = check.originality.result;
	if (result.verdict !== "no-earlier-copy" && result.verdict !== "copy") {
		return null;
	}
	if (gateCount === null || gateCount < ORIGINALITY_RULES.sizeFloor)
		return null;
	const copies: CopyListing[] = [];
	// Newest listed first, as the index returns them
	for (const l of await readOpenListings(pool, {
		netlistHash: result.netlistHash,
	})) {
		if (l.ask.seller === wallet) continue;
		const other = await readCircuitRef(pool, l.circuit);
		if (!other) {
			throw new Error(
				`Listing ${l.ask.listingId}: circuit #${l.circuit.id} on ${l.circuit.processor} isn't in the index`,
			);
		}
		if (!designedEarlier(circuit, other)) continue;
		copies.push({
			listing: l.ask,
			circuit: other,
			sameAddress: other.tapedOutBy === circuit.tapedOutBy,
			justListed: l.ask.listedAt.time + JUST_LISTED_SECONDS >= at.time,
		});
	}
	return copies.length === 0
		? null
		: { netlistHash: result.netlistHash, copies, rule: COPY_ALERT_RULE };
}

/** Miners with an alert first, then by processor and circuit id. */
function walletOrder(a: WalletMiner, b: WalletMiner): number {
	if ((a.alert === null) !== (b.alert === null)) return a.alert ? -1 : 1;
	if (a.circuit.processor !== b.circuit.processor) {
		return a.circuit.processor < b.circuit.processor ? -1 : 1;
	}
	return a.circuit.tokenId < b.circuit.tokenId ? -1 : 1;
}

function notReady(detail: string): WalletRead {
	return { ok: false, error: { error: "not-ready", detail } };
}

function plain(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** viem's full message names the RPC URL, which can carry a key: keep only its short message. */
function short(error: unknown): string {
	return (error as { shortMessage?: string }).shortMessage ?? plain(error);
}
