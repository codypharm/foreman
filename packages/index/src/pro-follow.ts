// The worker's backup read of Foreman Pro payments (docs/decisions/2026-11-26-pro-payments.md,
// decision 5). The page reports each payment by its transaction; this reads ForemanPro's Paid events
// from the X Layer testnet since the block it last read, so a payment the page never reported still
// counts. A payment already counted is not counted again. The payments and the block it read up to
// are saved together, or nothing is. Read only on chain.

import { type LogNode, readLogs } from "@foreman/chain-xlayer";
import { foremanProAbi, PRO_PRICE_WEI } from "@foreman/chain-xlayer/pro";
import type pg from "pg";
import { decodeEventLog, type PublicClient } from "viem";
import { type ProPayment, recordProPayment } from "./pro.ts";
import { inTransaction } from "./transaction.ts";

/** At most this many blocks a run: X Layer's blocks are a second apart, so a long gap takes several runs. */
export const PRO_FOLLOW_BLOCKS = 3000n;

export type ProFollow =
	| {
			followed: true;
			fromBlock: bigint;
			/** The block payments are now read up to. */
			toBlock: bigint;
			/** Payments counted by this read; 0 when the page had reported them all. */
			counted: number;
	  }
	/** Nothing saved; the read starts at the same block next time. */
	| { followed: false; detail: string };

export async function followProPayments(
	pool: pg.Pool,
	nodes: {
		/** The X Layer testnet: its chain id, and block times when a log lacks one. */
		client: PublicClient;
		/** Log reads, shared between them. */
		logNodes: readonly LogNode[];
	},
	options: {
		/** ForemanPro's address, from On-chain facts. */
		contract: `0x${string}`;
		/** The first block to read when nothing has been read: ForemanPro's deploy block. */
		startBlock: bigint;
		/** The latest block to read. */
		toBlock: bigint;
		maxBlocks?: bigint;
		/** Waits between log read tries; replaced in tests. */
		sleep?: (ms: number) => Promise<void>;
	},
): Promise<ProFollow> {
	const stored = await pool.query<{ up_to_block: string }>(
		"select up_to_block from pro_follow",
	);
	const fromBlock = stored.rows[0]
		? BigInt(stored.rows[0].up_to_block) + 1n
		: options.startBlock;
	try {
		const chainId = await nodes.client.getChainId();
		if (chainId !== 1952) {
			return {
				followed: false,
				detail: `the X Layer node answers for chain ${chainId}, not the testnet (1952)`,
			};
		}
		if (options.toBlock < fromBlock) {
			return { followed: true, fromBlock, toBlock: fromBlock - 1n, counted: 0 };
		}
		const cap = fromBlock + (options.maxBlocks ?? PRO_FOLLOW_BLOCKS) - 1n;
		const toBlock = options.toBlock < cap ? options.toBlock : cap;

		const logs = await readLogs(
			nodes.logNodes,
			{ addresses: [options.contract], fromBlock, toBlock },
			options.sleep ? { sleep: options.sleep } : {},
		);
		if (!logs.complete) return { followed: false, detail: logs.detail };

		const contract = options.contract.toLowerCase();
		const times = new Map<bigint, Date>();
		const payments: ProPayment[] = [];
		for (const log of logs.logs) {
			if (log.address.toLowerCase() !== contract) continue;
			let event: ReturnType<typeof decodeEventLog<typeof foremanProAbi>>;
			try {
				event = decodeEventLog({
					abi: foremanProAbi,
					data: log.data,
					topics: log.topics as never,
				});
			} catch {
				continue;
			}
			if (event.eventName !== "Paid" || event.args.amount !== PRO_PRICE_WEI)
				continue;
			let paidAt = times.get(log.blockNumber);
			if (!paidAt) {
				const seconds =
					log.blockTimestamp ??
					(await nodes.client.getBlock({ blockNumber: log.blockNumber }))
						.timestamp;
				paidAt = new Date(Number(seconds) * 1000);
				times.set(log.blockNumber, paidAt);
			}
			payments.push({
				txHash: log.transactionHash,
				logIndex: log.logIndex,
				block: log.blockNumber,
				paidAt,
				code: event.args.code,
				payer: event.args.payer,
				amount: event.args.amount,
			});
		}

		const counted = await inTransaction(pool, async (client) => {
			let n = 0;
			for (const payment of payments) {
				if ((await recordProPayment(client, payment)).counted) n += 1;
			}
			await client.query(
				`insert into pro_follow (up_to_block) values ($1)
				 on conflict (one) do update set up_to_block = excluded.up_to_block`,
				[toBlock],
			);
			return n;
		});
		return { followed: true, fromBlock, toBlock, counted };
	} catch (error) {
		return {
			followed: false,
			detail:
				error instanceof Error
					? (error.message.split("\n")[0] ?? "")
					: String(error),
		};
	}
}
