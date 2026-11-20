// The Sell offer for one miner (docs/decisions/2026-11-19-sell-without-bids.md): TapeOut's BNB
// market takes no bids, so the bid is always "no bid right now", and the offer carries the
// comparable sales and asks the stated rule gives (2026-11-20-sell-comparables.md).

import {
	type Miner,
	type Offer,
	parseOffer,
	serialiseOffer,
} from "@foreman/contract";
import {
	type MarketMinerState,
	type SellMarket,
	sellComparables,
} from "./comparables.ts";
import { ValuationInputError } from "./errors.ts";

export type SellOffer = Extract<Offer, { option: "sell" }>;

/** `miner` must be read at the market's block, so its weight and the comparables are of one moment. */
export function sellOffer(input: {
	miner: Miner;
	market: SellMarket;
}): SellOffer {
	const { miner, market } = input;
	if (miner.readAt.block !== market.at.block) {
		throw new ValuationInputError(
			`Miner ${miner.key} was read at block ${miner.readAt.block}, the market at block ${market.at.block}`,
		);
	}
	const state: MarketMinerState =
		miner.status === "active"
			? { mining: true, pool: miner.pool, weight: miner.weight }
			: { mining: false };
	const { sales, asks } = sellComparables({
		miner: state,
		sales: market.sales,
		asks: market.asks,
		at: market.at,
	});
	const offer: SellOffer = {
		option: "sell",
		minerKey: miner.key,
		bid: { state: "none", checkedAt: market.at.time },
		sales,
		asks,
	};
	// The contract's checks (pools agree, ranges ordered, nothing zero) run on every offer
	return parseOffer(serialiseOffer(offer, "offer"), "offer") as SellOffer;
}
