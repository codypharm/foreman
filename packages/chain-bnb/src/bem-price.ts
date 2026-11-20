// BEM's price in BNB for payback (docs/decisions/2026-11-20-payback-and-bem-price.md): the
// PancakeSwap v3 BEM/WBNB pool's 30-minute time-weighted average at one block, read with the pool's
// own oracle, plus what the pool holds. Missing when the pool can't give that average: never zero.

import {
	BEM_PRICE_AVERAGED_OVER,
	type BemPrice,
	type BnbRead,
	parseBemPrice,
	serialiseBemPrice,
} from "@foreman/contract";
import type { PublicClient } from "viem";
import {
	BEM,
	BEM_WBNB_POOL,
	erc20BalanceOfAbi,
	v3PoolAbi,
	WBNB,
} from "./abi.ts";

export type BemPriceRead =
	| { available: true; price: BemPrice }
	| { available: false; reason: string; readAt: BnbRead };

const WINDOW = BEM_PRICE_AVERAGED_OVER;
/** 1 BEM in base units: the price is quoted per whole BEM. */
const ONE_BEM = 10n ** 8n;

export async function readBemPrice(
	client: PublicClient,
	at: { blockNumber: bigint },
): Promise<BemPriceRead> {
	const { blockNumber } = at;
	const [block, code] = await Promise.all([
		client.getBlock({ blockNumber }),
		client.getCode({ address: BEM_WBNB_POOL, blockNumber }),
	]);
	const readAt: BnbRead = {
		chainId: 56,
		block: block.number,
		time: block.timestamp,
	};
	if (!code || code === "0x") {
		return {
			available: false,
			reason: "The BEM/WBNB pool doesn't exist at this block",
			readAt,
		};
	}
	const pool = { address: BEM_WBNB_POOL, abi: v3PoolAbi, blockNumber } as const;

	// The oldest observation the pool keeps, as its oracle library finds it: the slot after the
	// latest, or slot 0 while the ring isn't full yet
	const slot0 = await client.readContract({ ...pool, functionName: "slot0" });
	const [, , index, cardinality] = slot0;
	let oldest = await client.readContract({
		...pool,
		functionName: "observations",
		args: [BigInt((index + 1) % cardinality)],
	});
	if (!oldest[3]) {
		oldest = await client.readContract({
			...pool,
			functionName: "observations",
			args: [0n],
		});
	}
	const history = block.timestamp - BigInt(oldest[0]);
	if (history < BigInt(WINDOW)) {
		return {
			available: false,
			reason: `The BEM/WBNB pool has only ${history} seconds of price history; the average needs ${WINDOW}`,
			readAt,
		};
	}

	const [[cumulatives], poolBem, poolWbnb] = await Promise.all([
		client.readContract({
			...pool,
			functionName: "observe",
			args: [[WINDOW, 0]],
		}),
		client.readContract({
			address: BEM,
			abi: erc20BalanceOfAbi,
			functionName: "balanceOf",
			args: [BEM_WBNB_POOL],
			blockNumber,
		}),
		client.readContract({
			address: WBNB,
			abi: erc20BalanceOfAbi,
			functionName: "balanceOf",
			args: [BEM_WBNB_POOL],
			blockNumber,
		}),
	]);
	const [then, now] = cumulatives;
	if (then === undefined || now === undefined) {
		throw new Error("observe returned fewer than two tick cumulatives");
	}
	const price: BemPrice = {
		bnbPerBem: quoteAtTick(meanTick(now - then, BigInt(WINDOW)), ONE_BEM),
		pool: BEM_WBNB_POOL as BemPrice["pool"],
		averagedOver: WINDOW,
		poolBem,
		poolWbnb,
		readAt,
	};
	// A zero price (a tick so low the quote rounds to nothing) is refused here, not passed on
	return {
		available: true,
		price: parseBemPrice(serialiseBemPrice(price, "bemPrice"), "bemPrice"),
	};
}

/** The mean tick over the window, rounded toward negative infinity (the oracle library's rule). */
function meanTick(delta: bigint, seconds: bigint): bigint {
	const tick = delta / seconds; // bigint division truncates toward zero
	return delta < 0n && delta % seconds !== 0n ? tick - 1n : tick;
}

/**
 * token1 (WBNB wei) for `baseAmount` of token0 (BEM base units) at `tick`, rounded down: the
 * oracle library's getQuoteAtTick, with exact bigint arithmetic.
 */
function quoteAtTick(tick: bigint, baseAmount: bigint): bigint {
	const sqrtRatioX96 = sqrtRatioAtTick(tick);
	return (sqrtRatioX96 * sqrtRatioX96 * baseAmount) >> 192n;
}

const MAX_TICK = 887_272n;
const MAX_UINT256 = (1n << 256n) - 1n;

/** sqrt(1.0001^tick) × 2^96, as the pool's TickMath.getSqrtRatioAtTick computes it. */
function sqrtRatioAtTick(tick: bigint): bigint {
	const absTick = tick < 0n ? -tick : tick;
	if (absTick > MAX_TICK) throw new RangeError(`tick ${tick} out of range`);
	let ratio =
		(absTick & 0x1n) !== 0n
			? 0xfffcb933bd6fad37aa2d162d1a594001n
			: 0x100000000000000000000000000000000n;
	const steps: [bigint, bigint][] = [
		[0x2n, 0xfff97272373d413259a46990580e213an],
		[0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
		[0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
		[0x10n, 0xffcb9843d60f6159c9db58835c926644n],
		[0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
		[0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
		[0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
		[0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
		[0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
		[0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
		[0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
		[0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
		[0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
		[0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
		[0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
		[0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
		[0x20000n, 0x5d6af8dedb81196699c329225ee604n],
		[0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
		[0x80000n, 0x48a170391f7dc42444e8fa2n],
	];
	for (const [bit, factor] of steps) {
		if ((absTick & bit) !== 0n) ratio = (ratio * factor) >> 128n;
	}
	if (tick > 0n) ratio = MAX_UINT256 / ratio;
	// From Q128.128 to Q64.96, rounding up
	return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}
