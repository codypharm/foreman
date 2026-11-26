// Payments for Foreman Pro (docs/decisions/2026-11-26-pro-payments.md): each Telegram chat's code,
// the ForemanPro payments counted for it, and when its Pro ends. /stop forgets a chat's follows,
// never its code or what it paid.

import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { Hex } from "viem";

/** Days of Pro one payment buys (decision 2). */
export const PRO_DAYS = 30;
const PRO_MS = PRO_DAYS * 86_400_000;

/** A chat's code (16 bytes, 0x hex), made the first time it's asked and the same ever after. */
export async function proCode(pool: pg.Pool, chatId: bigint): Promise<Hex> {
	await pool.query(
		`insert into telegram_pro_codes (chat_id, code) values ($1, $2)
		 on conflict (chat_id) do nothing`,
		[chatId, randomBytes(16)],
	);
	const { rows } = await pool.query<{ code: Buffer }>(
		"select code from telegram_pro_codes where chat_id = $1",
		[chatId],
	);
	const code = rows[0]?.code;
	if (!code) throw new Error("the chat's Pro code wasn't saved");
	return `0x${code.toString("hex")}`;
}

/** One ForemanPro Paid log, read from the X Layer testnet. */
export interface ProPayment {
	txHash: Hex;
	logIndex: number;
	block: bigint;
	/** The block's time. */
	paidAt: Date;
	/** As emitted: 32 bytes, a chat's 16-byte code padded with zeros. */
	code: Hex;
	payer: string;
	amount: bigint;
}

/**
 * Counts a payment for the chat whose code it carries, once: a payment already counted (the page and
 * the worker both report it) is `counted: false`. A code that is no chat's is kept with no chat.
 */
export async function recordProPayment(
	pool: pg.Pool,
	payment: ProPayment,
): Promise<{ counted: boolean; chatId: bigint | null }> {
	const code = Buffer.from(payment.code.slice(2), "hex");
	if (code.length !== 32) throw new Error("a Paid code is 32 bytes");
	const padded = code.subarray(16).every((b) => b === 0);
	const inserted = await pool.query<{ chat_id: string | null }>(
		`insert into pro_payments (tx_hash, log_index, block, paid_at, code, payer, amount, chat_id)
		 values ($1, $2, $3, $4, $5, $6, $7,
		   (select chat_id from telegram_pro_codes where $8 and code = $9))
		 on conflict (tx_hash, log_index) do nothing
		 returning chat_id`,
		[
			Buffer.from(payment.txHash.slice(2), "hex"),
			payment.logIndex,
			payment.block,
			payment.paidAt,
			code,
			payment.payer.toLowerCase(),
			payment.amount.toString(),
			padded,
			code.subarray(0, 16),
		],
	);
	const row =
		inserted.rows[0] ??
		(
			await pool.query<{ chat_id: string | null }>(
				"select chat_id from pro_payments where tx_hash = $1 and log_index = $2",
				[Buffer.from(payment.txHash.slice(2), "hex"), payment.logIndex],
			)
		).rows[0];
	const chatId = row?.chat_id;
	return {
		counted: inserted.rows.length > 0,
		chatId: chatId == null ? null : BigInt(chatId),
	};
}

/**
 * When a chat's Pro ends, worked out from its payments in chain order: each adds PRO_DAYS from the
 * later of its own time and the end so far. Null for a chat that never paid. The end may be past.
 */
export async function readProUntil(
	pool: pg.Pool,
	chatId: bigint,
): Promise<Date | null> {
	const { rows } = await pool.query<{ paid_at: Date }>(
		"select paid_at from pro_payments where chat_id = $1 order by block, log_index",
		[chatId],
	);
	let until: number | null = null;
	for (const { paid_at } of rows) {
		until = Math.max(until ?? 0, paid_at.getTime()) + PRO_MS;
	}
	return until === null ? null : new Date(until);
}

/** Every chat that has paid for Pro at least once. */
export async function readProChats(pool: pg.Pool): Promise<bigint[]> {
	const { rows } = await pool.query<{ chat_id: string }>(
		"select distinct chat_id from pro_payments where chat_id is not null order by chat_id",
	);
	return rows.map((r) => BigInt(r.chat_id));
}

export type ProReminder = "ending" | "ended";

/** Whether this reminder was already sent for this end date. */
export async function proReminderSent(
	pool: pg.Pool,
	chatId: bigint,
	until: Date,
	kind: ProReminder,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		"select 1 from telegram_pro_reminders where chat_id = $1 and pro_until = $2 and kind = $3",
		[chatId, until, kind],
	);
	return (rowCount ?? 0) > 0;
}

/** Records a reminder as sent, once Telegram has accepted it. */
export async function recordProReminder(
	pool: pg.Pool,
	chatId: bigint,
	until: Date,
	kind: ProReminder,
): Promise<void> {
	await pool.query(
		`insert into telegram_pro_reminders (chat_id, pro_until, kind) values ($1, $2, $3)
		 on conflict do nothing`,
		[chatId, until, kind],
	);
}
