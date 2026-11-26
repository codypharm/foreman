// The API's check of a reported Foreman Pro payment (docs/decisions/2026-11-26-pro-payments.md,
// decision 5). The page sends a transaction hash; this reads its receipt from the X Layer testnet and
// counts each Paid log that came from the confirmed ForemanPro with exactly the amount, once. Nothing
// the page says is trusted beyond the hash: the chain decides what was paid and for which code.

import { foremanProAbi, PRO_PRICE_WEI } from "@foreman/chain-xlayer/pro";
import type { ApiError, Hex32 } from "@foreman/contract";
import { readProUntil, recordProPayment } from "@foreman/index";
import type pg from "pg";
import {
	decodeEventLog,
	type PublicClient,
	TransactionReceiptNotFoundError,
} from "viem";

export interface ProChain {
	/** The X Layer testnet. */
	client: PublicClient;
	/** ForemanPro's address, from On-chain facts. */
	contract: `0x${string}`;
}

export type ProPaymentCheck =
	| {
			ok: true;
			/** Paid logs counted now; 0 when they were already counted. */
			counted: number;
			/** When the paying code's chat has Pro until; null when the code is no chat's. */
			proUntil: Date | null;
	  }
	| { ok: false; error: ApiError };

export async function checkProPayment(
	pool: pg.Pool,
	chain: ProChain,
	txHash: Hex32,
): Promise<ProPaymentCheck> {
	let receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
	let paidAt: Date;
	try {
		receipt = await chain.client.getTransactionReceipt({ hash: txHash });
		const block = await chain.client.getBlock({
			blockNumber: receipt.blockNumber,
		});
		paidAt = new Date(Number(block.timestamp) * 1000);
	} catch (error) {
		if (error instanceof TransactionReceiptNotFoundError) {
			return refused(
				"not-ready",
				"The payment isn't in a block yet. Try again in a few seconds.",
			);
		}
		return refused(
			"read-failed",
			`X Layer testnet couldn't be read: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
		);
	}
	if (receipt.status !== "success") {
		return refused(
			"not-recognised",
			"That transaction failed, so nothing was paid.",
		);
	}

	const contract = chain.contract.toLowerCase();
	const paid = receipt.logs.flatMap((log) => {
		if (log.address.toLowerCase() !== contract) return [];
		try {
			const event = decodeEventLog({
				abi: foremanProAbi,
				data: log.data,
				topics: log.topics,
			});
			if (event.eventName !== "Paid" || event.args.amount !== PRO_PRICE_WEI)
				return [];
			return [{ log, args: event.args }];
		} catch {
			return [];
		}
	});
	if (paid.length === 0) {
		return refused(
			"not-recognised",
			"That transaction paid nothing to Foreman Pro.",
		);
	}

	let counted = 0;
	let chatId: bigint | null = null;
	for (const { log, args } of paid) {
		const r = await recordProPayment(pool, {
			txHash,
			logIndex: log.logIndex,
			block: receipt.blockNumber,
			paidAt,
			code: args.code,
			payer: args.payer,
			amount: args.amount,
		});
		if (r.counted) counted += 1;
		chatId ??= r.chatId;
	}
	return {
		ok: true,
		counted,
		proUntil: chatId === null ? null : await readProUntil(pool, chatId),
	};
}

const ACCEPTED = [
	"a successful X Layer testnet transaction that paid 0.01 test OKB to ForemanPro's pay(code)",
];

function refused(
	error: "not-recognised" | "not-ready" | "read-failed",
	detail: string,
): ProPaymentCheck {
	return {
		ok: false,
		error:
			error === "not-recognised"
				? { error, detail, accepted: ACCEPTED }
				: { error, detail },
	};
}
