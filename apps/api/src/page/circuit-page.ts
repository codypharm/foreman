// The result page for one circuit (docs/data-contract.md, CircuitPage): its stored result, whether
// it was published, and the live reads behind its value and options. BNB Chain is read at the
// market index's block, so the miner, the network, the BEM price, the listing and the Sell
// comparables are one moment; X Layer is read at its latest block
// (docs/decisions/2026-11-21-circuit-page-reads.md). A page is whole or an error: never partial,
// never a silent zero, and it goes through the contract's own parser before it is returned.

import {
	minerKey,
	POD_MINING,
	readBemPrice,
	readMiner,
	readNetworkState,
	UnknownMinerError,
} from "@foreman/chain-bnb";
import {
	FABX_MINING,
	readLendOffers,
	readVoucher,
} from "@foreman/chain-xlayer";
import {
	type ApiError,
	type BnbCircuitPage,
	type CircuitPage,
	type FabxCircuitPage,
	type Miner,
	type Multiplier,
	type Originality,
	type Published,
	parseAddress,
	parseCircuitPage,
	parseMultiplier,
	type StoredCheck,
	serialiseCircuitPage,
} from "@foreman/contract";
import {
	marketRead,
	type ResultsContract,
	readCircuitListing,
	readCircuitRef,
	readFabxMiner,
	readFabxState,
	readNetworkDays,
	readPublishedRow,
	readSellMarket,
	readStoredResult,
} from "@foreman/index";
import type { CircuitId } from "@foreman/originality";
import { payback, rentOffer, sellOffer, valueMiner } from "@foreman/valuation";
import type pg from "pg";
import { BaseError, type PublicClient } from "viem";
import { planEntry } from "../publish/plan.ts";
import { buildResult, type ResultContext } from "../result.ts";

/** Shown wherever an active miner in the unverified pool would have a value. */
export const NOT_VALUED_REASON =
	"Foreman doesn't value the unverified pool yet";

export interface PageDeps {
	pool: pg.Pool;
	/** BNB Chain, able to read the market index's block (the archive node). */
	bnb: PublicClient;
	/** X Layer mainnet (196), where RIG vouchers and TapePool live. */
	xlayer: PublicClient;
	/** The results contract whose record says what was published. */
	results: ResultsContract;
	/** The index loaded for building a pasted circuit's result on request. */
	resultContext: () => Promise<
		{ ready: true; context: ResultContext } | { ready: false; detail: string }
	>;
}

export type PageRead =
	| { ok: true; page: CircuitPage }
	| { ok: false; error: ApiError };

const multiplierAbi = [
	{
		name: "processorMultiplier",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "processor", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

export async function readCircuitPage(
	deps: PageDeps,
	circuit: CircuitId,
): Promise<PageRead> {
	const { pool, bnb } = deps;
	const ref = await readCircuitRef(pool, circuit);
	if (!ref) {
		return fail(
			"unknown-circuit",
			`Circuit #${circuit.id} on processor ${circuit.processor} isn't in Foreman's index`,
		);
	}
	if (ref.chainId === 196) return readFabxPage(deps, circuit, ref);
	let at: Awaited<ReturnType<typeof marketRead>>;
	try {
		at = await marketRead(pool);
	} catch (error) {
		return fail("not-ready", plain(error));
	}
	const key = minerKey(circuit);
	const blockNumber = at.block;

	try {
		const [miner, multiplier, network, bemPrice, listing, market, days] =
			await Promise.all([
				readMinerOrNull(bnb, key, blockNumber),
				readMultiplier(bnb, circuit, blockNumber),
				readNetworkState(bnb, { blockNumber }),
				readBemPrice(bnb, { blockNumber }),
				readCircuitListing(pool, circuit),
				readSellMarket(pool),
				readNetworkDays(pool),
			]);
		if (market.at.block !== blockNumber) {
			return fail(
				"not-ready",
				"The market index moved while the page was read; try again",
			);
		}

		const check = await storedCheck(deps, circuit, {
			isMiner: miner !== null,
			isListed: listing !== null,
		});
		const published = await publishedState(deps, check, key);

		const xlayerBlock = await deps.xlayer.getBlockNumber();
		const voucher = await readVoucher(deps.xlayer, {
			minerKey: key,
			blockNumber: xlayerBlock,
		});
		const lend = await readLendOffers(deps.xlayer, {
			minerKey: key,
			blockNumber: xlayerBlock,
			voucher,
		});
		const [lend7, lend14] = lend;
		if (!lend7 || !lend14) throw new Error("Lend gave fewer than two terms");

		const active = miner?.status === "active";
		let hold: BnbCircuitPage["hold"];
		let paybackRead: BnbCircuitPage["payback"];
		if (active && miner.pool === "unverified") {
			hold = { state: "not-valued", reason: NOT_VALUED_REASON };
			paybackRead = {
				state: "not-valued",
				minerKey: key,
				reason: NOT_VALUED_REASON,
				readAt: at,
			};
		} else {
			const valued = active
				? {
						thirtyDays: valueMiner({ miner, network, days, window: "30d" }),
						toHalving: valueMiner({
							miner,
							network,
							days,
							window: "to-2030-halving",
						}),
					}
				: null;
			hold = valued ? { state: "shown", ...valued } : { state: "not-mining" };
			paybackRead = payback({
				minerKey: key,
				readAt: at,
				miner: valued
					? {
							mining: true,
							inputs: valued.thirtyDays.inputs,
							model: valued.thirtyDays.model,
						}
					: { mining: false },
				listing: listing?.buyable
					? { listingId: listing.listingId, priceWei: listing.ask.value }
					: null,
				bemPrice: bemPrice.available
					? { available: true, price: bemPrice.price }
					: { available: false, reason: bemPrice.reason },
			});
		}

		const page: BnbCircuitPage = {
			circuit: ref,
			multiplier,
			check,
			published,
			miner,
			listing,
			voucher,
			hold,
			payback: paybackRead,
			options: {
				sell: miner
					? sellOffer({ miner, market })
					: sellOffer({ miner: null, minerKey: key, market }),
				lend: [lend7, lend14],
				rent: rentOffer(key),
			},
			bemPrice: bemPrice.available
				? bemPrice.price
				: { state: "no-price", reason: bemPrice.reason },
		};
		// The contract's checks: one circuit, one key, values and payback agreeing with the miner
		return {
			ok: true,
			page: parseCircuitPage(serialiseCircuitPage(page, "page"), "page"),
		};
	} catch (error) {
		return fail("read-failed", plain(error));
	}
}

/**
 * A FabX circuit's page, entirely from what is stored with FabX's history: its result, FabX's miner
 * record and FabX's state. No live read, and no value or offer (2026-11-26-fabx-circuit-page.md).
 */
async function readFabxPage(
	deps: PageDeps,
	circuit: CircuitId,
	ref: FabxCircuitPage["circuit"],
): Promise<PageRead> {
	try {
		const state = await readFabxState(deps.pool);
		if (!state) return fail("not-ready", "FabX's history isn't stored yet");
		const record = await readFabxMiner(deps.pool, circuit);
		const check = await storedCheck(deps, circuit, {
			isMiner: record !== null,
			isListed: false,
		});
		const published = await publishedState(deps, check, minerKey(circuit));
		const page: FabxCircuitPage = {
			circuit: ref,
			check,
			published,
			miner: record && {
				taskId: record.taskId,
				readAtBlock: record.readAtBlock,
			},
			fabx: {
				contract: parseAddress(FABX_MINING, "FABX_MINING"),
				followedTo: state.logsUpToBlock,
				frozenAtBlock: state.frozenAtBlock,
			},
		};
		return {
			ok: true,
			page: parseCircuitPage(serialiseCircuitPage(page, "page"), "page"),
		};
	} catch (error) {
		return fail("read-failed", plain(error));
	}
}

async function readMinerOrNull(
	client: PublicClient,
	key: ReturnType<typeof minerKey>,
	blockNumber: bigint,
): Promise<Miner | null> {
	try {
		return await readMiner(client, key, { blockNumber });
	} catch (error) {
		// Never started mining: no miner. Any other failure is a failed read, never "no miner"
		if (error instanceof UnknownMinerError) return null;
		throw error;
	}
}

async function readMultiplier(
	client: PublicClient,
	circuit: CircuitId,
	blockNumber: bigint,
): Promise<Multiplier> {
	const value = await client.readContract({
		address: POD_MINING,
		abi: multiplierAbi,
		functionName: "processorMultiplier",
		args: [circuit.processor],
		blockNumber,
	});
	return parseMultiplier(Number(value), "processorMultiplier");
}

/**
 * The stored result for a miner or a listed circuit; any other circuit's result is built on
 * request as "pasted" and never stored (2026-11-21-stored-results.md, decision 1).
 */
async function storedCheck(
	deps: PageDeps,
	circuit: CircuitId,
	is: { isMiner: boolean; isListed: boolean },
): Promise<StoredCheck> {
	const stored = await readStoredResult(deps.pool, circuit);
	if (stored) return { state: "checked", originality: stored.originality };
	if (is.isMiner || is.isListed) {
		return {
			state: "not-checked",
			detail: "Foreman hasn't checked this circuit yet",
		};
	}
	const loaded = await deps.resultContext();
	if (!loaded.ready) return { state: "not-checked", detail: loaded.detail };
	const built = await buildResult(loaded.context, circuit, "pasted");
	return built.ok
		? { state: "checked", originality: built.originality }
		: { state: "not-checked", detail: built.detail };
}

/** Current when the stored result's hash is the one published for this circuit; older otherwise, saying whether its verdict holds. */
async function publishedState(
	deps: PageDeps,
	check: StoredCheck,
	key: ReturnType<typeof minerKey>,
): Promise<Published> {
	const scope: Originality["scope"] | null =
		check.state === "checked" ? check.originality.scope : null;
	if (scope === "pasted") return { state: "not-published", reason: "pasted" };
	const row = await readPublishedRow(deps.pool, deps.results, key);
	if (!row || check.state !== "checked") {
		return { state: "not-published", reason: "not-yet" };
	}
	const entry = planEntry(check.originality);
	const rest = {
		publishedAt: {
			chainId: deps.results.chainId,
			block: row.block,
			tx: row.tx,
		},
		contract: deps.results.address,
		resultHash: row.resultHash,
	};
	if (entry.resultHash === row.resultHash) return { state: "current", ...rest };
	// Whether the published verdict still holds: the same fingerprint means the publish job won't send
	// it again (2026-11-23-same-verdict-read-back.md)
	return {
		state: "older",
		verdict: entry.fingerprint === row.fingerprint ? "same" : "changed",
		...rest,
	};
}

function fail(
	error: Exclude<ApiError["error"], "not-recognised">,
	detail: string,
): PageRead {
	return { ok: false, error: { error, detail } };
}

/** Plain words for the screen: viem's short message, never the node's URL or the call's data. */
function plain(error: unknown): string {
	if (error instanceof BaseError) return error.shortMessage;
	return error instanceof Error ? error.message : String(error);
}
