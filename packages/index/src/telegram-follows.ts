// Telegram chats following addresses for copy alerts (docs/decisions/2026-11-23-copy-alert-notifications.md,
// decisions 4 and 10; 2026-11-26-telegram-alerts-for-pro.md, decision 2). A chat follows up to its
// limit: the caller passes it, one address free and more with Foreman Pro.

import type pg from "pg";
import type { Address } from "viem";

export interface TelegramFollow {
	chatId: bigint;
	address: Address;
	/** The BNB Chain block the address was followed at: listings at or before it are never sent. */
	followedAtBlock: bigint;
}

export type FollowOutcome =
	| { status: "followed" }
	| { status: "already" }
	| { status: "limit"; limit: number };

/** Follows `address` for `chatId`, unless the chat already follows `limit` addresses. */
export async function followAddress(
	pool: pg.Pool,
	follow: {
		chatId: bigint;
		address: Address;
		atBlock: bigint;
		limit: number;
	},
): Promise<FollowOutcome> {
	const address = follow.address.toLowerCase();
	const client = await pool.connect();
	try {
		await client.query("begin");
		// One follow at a time per chat, so two quick /follow commands can't both pass the limit
		await client.query("select pg_advisory_xact_lock($1)", [follow.chatId]);
		const rows = await client.query<{ address: string }>(
			"select address from telegram_follows where chat_id = $1",
			[follow.chatId],
		);
		let outcome: FollowOutcome;
		if (rows.rows.some((r) => r.address === address)) {
			outcome = { status: "already" };
		} else if (rows.rows.length >= follow.limit) {
			outcome = { status: "limit", limit: follow.limit };
		} else {
			await client.query(
				"insert into telegram_follows (chat_id, address, followed_at_block) values ($1, $2, $3)",
				[follow.chatId, address, follow.atBlock],
			);
			outcome = { status: "followed" };
		}
		await client.query("commit");
		return outcome;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

/** The addresses a chat follows, in the order it followed them; every chat's when `chatId` is omitted. */
export async function readFollows(
	pool: pg.Pool,
	chatId?: bigint,
): Promise<TelegramFollow[]> {
	const rows = await pool.query<{
		chat_id: string;
		address: Address;
		followed_at_block: string;
	}>(
		`select chat_id, address, followed_at_block from telegram_follows
		 ${chatId === undefined ? "" : "where chat_id = $1"}
		 order by chat_id, follow_order`,
		chatId === undefined ? [] : [chatId],
	);
	return rows.rows.map((r) => ({
		chatId: BigInt(r.chat_id),
		address: r.address,
		followedAtBlock: BigInt(r.followed_at_block),
	}));
}

/** Stops following `address` for `chatId`. Returns whether it was followed. */
export async function unfollowAddress(
	pool: pg.Pool,
	chatId: bigint,
	address: Address,
): Promise<boolean> {
	const done = await pool.query(
		"delete from telegram_follows where chat_id = $1 and address = $2",
		[chatId, address.toLowerCase()],
	);
	return (done.rowCount ?? 0) > 0;
}

/** Forgets a chat: its follows and the record of what was sent to it (/stop, or the bot blocked). */
export async function stopChat(pool: pg.Pool, chatId: bigint): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query("delete from telegram_follows where chat_id = $1", [
			chatId,
		]);
		await client.query("delete from telegram_sent where chat_id = $1", [
			chatId,
		]);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

/** Records listings as sent to a chat, so each is sent to it at most once. */
export async function recordSent(
	pool: pg.Pool,
	chatId: bigint,
	listingIds: bigint[],
): Promise<void> {
	if (listingIds.length === 0) return;
	await pool.query(
		`insert into telegram_sent (chat_id, listing_id)
		 select $1, unnest($2::bigint[]) on conflict do nothing`,
		[chatId, listingIds.map(String)],
	);
}

/** The listings already sent to a chat. */
export async function readSent(
	pool: pg.Pool,
	chatId: bigint,
): Promise<Set<bigint>> {
	const rows = await pool.query<{ listing_id: string }>(
		"select listing_id from telegram_sent where chat_id = $1",
		[chatId],
	);
	return new Set(rows.rows.map((r) => BigInt(r.listing_id)));
}
