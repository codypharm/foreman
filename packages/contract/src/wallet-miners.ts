// A wallet's miners and their copy alerts (docs/data-contract.md, "API responses"; approved 21 Nov
// 2026 in docs/decisions/2026-11-21-api-endpoints.md, decisions 5 and 6). One alert per owned miner:
// the open listings of later identical circuits at or above the size floor, not listed by the wallet,
// newest first. Facts, never accusations.

import {
	type ListingAsk,
	listedAfter,
	type Multiplier,
	parseListingAsk,
	parseMultiplier,
	parseStoredCheck,
	type StoredCheck,
	sameWire,
	serialiseListingAsk,
	serialiseStoredCheck,
	toWire,
} from "./api-shared.ts";
import { ContractParseError } from "./errors.ts";
import { type ChainRead, parseChainRead } from "./offer.ts";
import {
	type CircuitRef,
	designedEarlier,
	parseCircuitRef,
} from "./originality.ts";
import {
	type Address,
	type Hex32,
	parseAddress,
	parseBoolean,
	parseHex32,
	parseObject,
	parseOneOf,
	parseText,
	parseUint,
} from "./wire.ts";

export interface CopyListing {
	listing: ListingAsk;
	/** A later identical circuit: same netlist hash, later design time. */
	circuit: CircuitRef;
	/** Taped out by the same address as the wallet's miner. */
	sameAddress: boolean;
	/** Listed within 7 days of the response's market read. */
	justListed: boolean;
}

export interface CopyAlert {
	netlistHash: Hex32;
	/** Newest listing first; every one. The screen shows the first 3 and "Show all". */
	copies: CopyListing[];
	/** Shown on screen. */
	rule: string;
}

export interface WalletMiner {
	circuit: CircuitRef;
	minerKey: Hex32;
	/** ownerSince: the block of its last Transfer to this wallet. */
	heldAs:
		| { kind: "nft"; ownerSince: bigint }
		| { kind: "voucher"; voucherId: bigint };
	multiplier: Multiplier;
	check: StoredCheck;
	/** null when no copy is listed. */
	alert: CopyAlert | null;
}

export interface WalletMiners {
	wallet: Address;
	/** The owner follow's block. */
	owners: { chainId: 56; upToBlock: bigint };
	/** The live RIG voucher read, on X Layer. */
	vouchers: ChainRead;
	market: { venue: "bnb-market"; upTo: ChainRead };
	/** Miners with an alert first, then by circuit. */
	miners: WalletMiner[];
}

/** "Just listed": within 7 days of the market read. */
export const JUST_LISTED_SECONDS = 7n * 86_400n;

export function parseWalletMiners(wire: unknown, field: string): WalletMiners {
	const w = parseObject(wire, field);
	const owners = parseObject(w.owners, `${field}.owners`);
	if (owners.chainId !== 56) {
		throw new ContractParseError(
			`${field}.owners.chainId`,
			"56 (the miners' NFTs are on BNB Chain)",
			owners.chainId,
		);
	}
	const market = parseObject(w.market, `${field}.market`);
	if (!Array.isArray(w.miners)) {
		throw new ContractParseError(
			`${field}.miners`,
			"a list of miners",
			w.miners,
		);
	}
	const wallet: WalletMiners = {
		wallet: parseAddress(w.wallet, `${field}.wallet`),
		owners: {
			chainId: 56,
			upToBlock: parseUint(owners.upToBlock, `${field}.owners.upToBlock`),
		},
		vouchers: parseChainRead(w.vouchers, `${field}.vouchers`, 196),
		market: {
			venue: parseOneOf(market.venue, `${field}.market.venue`, [
				"bnb-market",
			] as const),
			upTo: parseChainRead(market.upTo, `${field}.market.upTo`, 56),
		},
		miners: w.miners.map((m, i) => parseMiner(m, `${field}.miners[${i}]`)),
	};
	checkMiners(wallet, field);
	return wallet;
}

/** A wallet's miners for the wire. Parses its own output, so it never sends what the app would refuse. */
export function serialiseWalletMiners(
	wallet: WalletMiners,
	field: string,
): Record<string, unknown> {
	const wire = {
		wallet: wallet.wallet,
		owners: toWire(wallet.owners, `${field}.owners`),
		vouchers: toWire(wallet.vouchers, `${field}.vouchers`),
		market: toWire(wallet.market, `${field}.market`),
		miners: wallet.miners.map((m, i) => {
			const at = `${field}.miners[${i}]`;
			return {
				circuit: toWire(m.circuit, `${at}.circuit`),
				minerKey: m.minerKey,
				heldAs: toWire(m.heldAs, `${at}.heldAs`),
				multiplier: m.multiplier,
				check: serialiseStoredCheck(m.check, `${at}.check`),
				alert: m.alert && {
					netlistHash: m.alert.netlistHash,
					copies: m.alert.copies.map((c, j) => ({
						listing: serialiseListingAsk(
							c.listing,
							`${at}.alert.copies[${j}].listing`,
						),
						circuit: toWire(c.circuit, `${at}.alert.copies[${j}].circuit`),
						sameAddress: c.sameAddress,
						justListed: c.justListed,
					})),
					rule: m.alert.rule,
				},
			};
		}),
	};
	parseWalletMiners(wire, field);
	return wire;
}

function parseMiner(wire: unknown, field: string): WalletMiner {
	const w = parseObject(wire, field);
	return {
		circuit: parseCircuitRef(w.circuit, `${field}.circuit`),
		minerKey: parseHex32(w.minerKey, `${field}.minerKey`),
		heldAs: parseHeldAs(w.heldAs, `${field}.heldAs`),
		multiplier: parseMultiplier(w.multiplier, `${field}.multiplier`),
		check: parseStoredCheck(w.check, `${field}.check`),
		alert: w.alert === null ? null : parseAlert(w.alert, `${field}.alert`),
	};
}

function parseHeldAs(wire: unknown, field: string): WalletMiner["heldAs"] {
	const w = parseObject(wire, field);
	const kind = parseOneOf(w.kind, `${field}.kind`, ["nft", "voucher"] as const);
	return kind === "nft"
		? { kind, ownerSince: parseUint(w.ownerSince, `${field}.ownerSince`) }
		: { kind, voucherId: parseUint(w.voucherId, `${field}.voucherId`) };
}

function parseAlert(wire: unknown, field: string): CopyAlert {
	const w = parseObject(wire, field);
	if (!Array.isArray(w.copies)) {
		throw new ContractParseError(
			`${field}.copies`,
			"a list of copy listings",
			w.copies,
		);
	}
	return {
		netlistHash: parseHex32(w.netlistHash, `${field}.netlistHash`),
		copies: w.copies.map((c, i) => parseCopy(c, `${field}.copies[${i}]`)),
		rule: parseText(w.rule, `${field}.rule`),
	};
}

function parseCopy(wire: unknown, field: string): CopyListing {
	const w = parseObject(wire, field);
	return {
		listing: parseListingAsk(w.listing, `${field}.listing`),
		circuit: parseCircuitRef(w.circuit, `${field}.circuit`),
		sameAddress: parseBoolean(w.sameAddress, `${field}.sameAddress`),
		justListed: parseBoolean(w.justListed, `${field}.justListed`),
	};
}

/** Alerts first, then by circuit; each miner's stored result and alert are about it. */
function checkMiners(wallet: WalletMiners, field: string): void {
	wallet.miners.forEach((miner, i) => {
		const at = `${field}.miners[${i}]`;
		const before = wallet.miners[i - 1];
		if (before && !inOrder(before, miner)) {
			throw new ContractParseError(
				at,
				"miners with an alert first, then by processor and circuit id",
				`${miner.circuit.processor} #${miner.circuit.tokenId}`,
			);
		}
		if (
			miner.heldAs.kind === "nft" &&
			miner.heldAs.ownerSince > wallet.owners.upToBlock
		) {
			throw new ContractParseError(
				`${at}.heldAs.ownerSince`,
				`no later than the owner follow's block (${wallet.owners.upToBlock})`,
				miner.heldAs.ownerSince,
			);
		}
		if (
			miner.check.state === "checked" &&
			!sameWire(miner.check.originality.circuit, miner.circuit)
		) {
			throw new ContractParseError(
				`${at}.check.originality.circuit`,
				`this miner's circuit (${miner.circuit.processor} #${miner.circuit.tokenId})`,
				`${miner.check.originality.circuit.processor} #${miner.check.originality.circuit.tokenId}`,
			);
		}
		if (miner.alert) checkAlert(wallet, miner, miner.alert, `${at}.alert`);
	});
}

/** Only later identical circuits at or above the floor, not the wallet's own listings, newest first, with true facts. */
function checkAlert(
	wallet: WalletMiners,
	miner: WalletMiner,
	alert: CopyAlert,
	field: string,
): void {
	const result =
		miner.check.state === "checked" ? miner.check.originality.result : null;
	if (
		result === null ||
		result.verdict === "too-small-to-tell" ||
		result.verdict === "cant-check" ||
		result.verdict === "wrapper"
	) {
		throw new ContractParseError(
			field,
			"no alert: an alert needs a checked design at or above the size floor",
			result?.verdict ?? "not-checked",
		);
	}
	if (alert.netlistHash !== result.netlistHash) {
		throw new ContractParseError(
			`${field}.netlistHash`,
			`this miner's netlist hash (${result.netlistHash})`,
			alert.netlistHash,
		);
	}
	if (alert.copies.length === 0) {
		throw new ContractParseError(
			`${field}.copies`,
			"at least one copy listed; with none the alert is null",
			alert.copies,
		);
	}
	alert.copies.forEach((copy, j) => {
		const at = `${field}.copies[${j}]`;
		if (!designedEarlier(miner.circuit, copy.circuit)) {
			throw new ContractParseError(
				`${at}.circuit`,
				`a circuit designed after this miner (#${miner.circuit.tokenId})`,
				`#${copy.circuit.tokenId}`,
			);
		}
		if (copy.listing.seller === wallet.wallet) {
			throw new ContractParseError(
				`${at}.listing.seller`,
				"a seller other than this wallet",
				copy.listing.seller,
			);
		}
		const sameAddress = copy.circuit.tapedOutBy === miner.circuit.tapedOutBy;
		if (copy.sameAddress !== sameAddress) {
			throw new ContractParseError(
				`${at}.sameAddress`,
				`${sameAddress} (taped out by ${copy.circuit.tapedOutBy})`,
				copy.sameAddress,
			);
		}
		const justListed =
			copy.listing.listedAt.time + JUST_LISTED_SECONDS >=
			wallet.market.upTo.time;
		if (copy.justListed !== justListed) {
			throw new ContractParseError(
				`${at}.justListed`,
				`${justListed} (listed at ${copy.listing.listedAt.time}, market read at ${wallet.market.upTo.time})`,
				copy.justListed,
			);
		}
		const above = alert.copies[j - 1];
		if (above && !listedAfter(above.listing, copy.listing)) {
			throw new ContractParseError(
				`${at}.listing.listedAt`,
				`listed before the copy above it (listing ${above.listing.listingId})`,
				`listing ${copy.listing.listingId}`,
			);
		}
	});
}

function inOrder(a: WalletMiner, b: WalletMiner): boolean {
	if ((a.alert === null) !== (b.alert === null)) return a.alert !== null;
	if (a.circuit.processor !== b.circuit.processor) {
		return a.circuit.processor < b.circuit.processor;
	}
	return a.circuit.tokenId < b.circuit.tokenId;
}
