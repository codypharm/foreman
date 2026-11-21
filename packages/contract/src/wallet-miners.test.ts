import { describe, expect, test } from "vitest";
import { parseWalletMiners, serialiseWalletMiners } from "./index.ts";

// A wallet's miners and their copy alerts (docs/data-contract.md, "API responses"). The real case
// from the copy alert mock: #1080 (processor ×6, listing 26474, 67 BNB) is identical to #2553
// (processor ×1), whose design commitment came 22 hours before #1080's tape-out, by another address.

const X1 = "0xb1024b89886b9a34aa4ff5f31c411d708b20a14c";
const X6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const WALLET = `0x${"25".repeat(20)}`;
const OTHER = `0x${"6f".repeat(20)}`;
const HASH = `0x${"da".repeat(32)}`;
const AT_BNB = { chainId: 56, block: "134724711", time: "1795190000" };
const DAY = 86_400;

function circuit(
	processor: string,
	tokenId: string,
	block: string,
	by: string,
	committed: string | null = null,
) {
	return {
		chainId: 56,
		processor,
		tokenId,
		tapedOutAt: { block, txIndex: 3, logIndex: 7, time: "1787400000" },
		tapedOutBy: by,
		designCommittedAt: committed
			? { block: committed, time: "1787320000" }
			: null,
	};
}

const C2553 = circuit(X1, "2553", "117400000", WALLET, "117336633");
const C1080 = circuit(X6, "1080", "117513041", OTHER);
const C1670 = circuit(X1, "1670", "117200000", WALLET);

function checked(c: Record<string, unknown>) {
	return {
		state: "checked",
		originality: {
			circuit: c,
			scope: "miner",
			result: { verdict: "no-earlier-copy", netlistHash: HASH },
			facts: [{ fact: "can-mine", state: "mining" }],
			occc: { status: "not-checked" },
			index: {
				circuitsChecked: "80290",
				upToBlock: { chainId: 56, block: "134712080" },
			},
			ruleVersion: "hash 2026-11-20, floor 4, chain 10",
		},
	};
}

function copyListing(overrides: Record<string, unknown> = {}) {
	return {
		listing: {
			listingId: "26474",
			seller: OTHER,
			ask: { currency: "BNB", value: "67000000000000000000" },
			listedAt: { block: "134600000", time: `${1795190000 - 30 * DAY}` },
			buyable: true,
			readAt: AT_BNB,
		},
		circuit: C1080,
		sameAddress: false,
		justListed: false,
		...overrides,
	};
}

function wireWallet(overrides: Record<string, unknown> = {}) {
	return {
		wallet: WALLET,
		owners: { chainId: 56, upToBlock: "134724711" },
		vouchers: { chainId: 196, block: "76432567", time: "1795190000" },
		market: { venue: "bnb-market", upTo: AT_BNB },
		miners: [
			{
				circuit: C2553,
				minerKey: `0x${"53".repeat(32)}`,
				heldAs: { kind: "nft", ownerSince: "117400000" },
				multiplier: 1,
				check: checked(C2553),
				alert: {
					netlistHash: HASH,
					copies: [copyListing()],
					rule: "Open listings of later identical circuits, at or above 4 gates, not listed by this wallet",
				},
			},
			{
				circuit: C1670,
				minerKey: `0x${"16".repeat(32)}`,
				heldAs: { kind: "nft", ownerSince: "117200000" },
				multiplier: 1,
				check: checked(C1670),
				alert: null,
			},
		],
		...overrides,
	};
}

describe("a wallet's miners on the wire", () => {
	test("read back unchanged: the miner with a copy listed first, its alert naming the later circuit", () => {
		const wallet = parseWalletMiners(wireWallet(), "wallet");
		expect(wallet.miners[0]).toMatchObject({
			circuit: { tokenId: 2553n },
			alert: {
				copies: [{ circuit: { tokenId: 1080n }, sameAddress: false }],
			},
		});
		expect(wallet.miners[1]?.alert).toBeNull();
		const sent = JSON.parse(
			JSON.stringify(serialiseWalletMiners(wallet, "wallet")),
		);
		expect(sent).toEqual(wireWallet());
	});
});

describe("a wallet response that doesn't hold together", () => {
	const base = wireWallet();
	const [withAlert, without] = base.miners as unknown as [
		Record<string, unknown> & { alert: Record<string, unknown> },
		Record<string, unknown>,
	];
	const withCopies = (...copies: unknown[]) => ({
		miners: [{ ...withAlert, alert: { ...withAlert.alert, copies } }, without],
	});
	const tooSmall = checked(C2553);
	tooSmall.originality.result = {
		verdict: "too-small-to-tell",
		sameAs: 3,
		earliest: C1670,
		netlistHash: HASH,
		gateCount: 3,
		floor: 4,
	} as never;

	test.each([
		[
			"an alert naming an earlier circuit",
			withCopies(copyListing({ circuit: C1670, sameAddress: true })),
			"wallet.miners[0].alert.copies[0].circuit",
		],
		[
			"an alert naming the miner itself",
			withCopies(copyListing({ circuit: C2553, sameAddress: true })),
			"wallet.miners[0].alert.copies[0].circuit",
		],
		[
			"a copy listed by the wallet itself",
			withCopies(
				copyListing({
					listing: { ...copyListing().listing, seller: WALLET },
				}),
			),
			"wallet.miners[0].alert.copies[0].listing.seller",
		],
		[
			"the wrong tape-out address fact",
			withCopies(copyListing({ sameAddress: true })),
			"wallet.miners[0].alert.copies[0].sameAddress",
		],
		[
			"a listing from yesterday not marked just listed",
			withCopies(
				copyListing({
					listing: {
						...copyListing().listing,
						listedAt: { block: "134700000", time: `${1795190000 - DAY}` },
					},
				}),
			),
			"wallet.miners[0].alert.copies[0].justListed",
		],
		[
			"copies that aren't newest first",
			withCopies(
				copyListing(),
				copyListing({
					listing: {
						...copyListing().listing,
						listingId: "28000",
						listedAt: { block: "134700000", time: `${1795190000 - 9 * DAY}` },
					},
				}),
			),
			"wallet.miners[0].alert.copies[1].listing.listedAt",
		],
		["an alert with no copies", withCopies(), "wallet.miners[0].alert.copies"],
		[
			"an alert on a design below the size floor",
			{ miners: [{ ...withAlert, check: tooSmall }, without] },
			"wallet.miners[0].alert",
		],
		[
			"an alert for another netlist",
			{
				miners: [
					{
						...withAlert,
						alert: { ...withAlert.alert, netlistHash: `0x${"11".repeat(32)}` },
					},
					without,
				],
			},
			"wallet.miners[0].alert.netlistHash",
		],
		[
			"a stored result for another circuit",
			{ miners: [{ ...withAlert, check: checked(C1670) }, without] },
			"wallet.miners[0].check.originality.circuit",
		],
		[
			"a miner without an alert listed before one with",
			{ miners: [without, withAlert] },
			"wallet.miners[1]",
		],
		[
			"owned since after the owner follow's block",
			{
				miners: [
					{ ...withAlert, heldAs: { kind: "nft", ownerSince: "134724712" } },
					without,
				],
			},
			"wallet.miners[0].heldAs.ownerSince",
		],
	] as [string, Record<string, unknown>, string][])(
		"is refused: %s",
		(_why, overrides, field) => {
			expect(() => parseWalletMiners(wireWallet(overrides), "wallet")).toThrow(
				expect.objectContaining({ name: "ContractParseError", field }),
			);
		},
	);
});
