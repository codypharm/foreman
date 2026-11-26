// The Telegram bot's commands (docs/decisions/2026-11-23-copy-alert-notifications.md, decisions 2, 4
// and 10; 2026-11-26-telegram-alerts-for-pro.md, decision 2). It sends copy alerts only: it answers
// no lookups, verdicts or values in chat. Anyone can follow any address, with no signature, one at a
// time without Foreman Pro. A follow starts at the market's current block, so copies already
// listed are never sent.

import { parseAddress } from "@foreman/contract";
import {
	followAddress,
	marketRead,
	PRO_DAYS,
	proCode,
	readFollows,
	readProUntil,
	stopChat,
	unfollowAddress,
} from "@foreman/index";
import type pg from "pg";
import { formatDay, shortAddress } from "./message.ts";

/** Addresses one chat can follow: free, and with Foreman Pro (2026-11-26-telegram-alerts-for-pro.md). */
export const FREE_FOLLOWS = 1;
export const PRO_FOLLOWS = 20;

export interface BotDeps {
	pool: pg.Pool;
	now: () => number;
	/** The web app's address, for the pay link. */
	webUrl: string;
}

/** How many addresses a chat may follow now: PRO_FOLLOWS while its Pro lasts (2026-11-26-pro-payments.md). */
export async function followLimit(
	pool: pg.Pool,
	chatId: bigint,
	now: number,
): Promise<number> {
	const until = await readProUntil(pool, chatId);
	return until !== null && until.getTime() > now ? PRO_FOLLOWS : FREE_FOLLOWS;
}

/** The page that pays for this chat's Pro, by its code (decision 4). */
export async function payLink(
	deps: { pool: pg.Pool; webUrl: string },
	chatId: bigint,
): Promise<string> {
	const code = await proCode(deps.pool, chatId);
	return `${deps.webUrl.replace(/\/+$/, "")}/#/pro/${code.slice(2)}`;
}

export const HELP = [
	"Foreman sends a message when a copy of a miner held by an address you follow is listed on TapeOut's market.",
	"",
	"/follow 0x… follows an address",
	"/unfollow 0x… stops following it",
	"/list shows what this chat follows",
	"/pro shows Foreman Pro, to follow up to 20 addresses",
	"/stop forgets this chat",
].join("\n");

/** The reply to one text message. */
export async function handleCommand(
	deps: BotDeps,
	chatId: bigint,
	text: string,
): Promise<string> {
	const [rawCommand = "", arg = ""] = text.trim().split(/\s+/);
	// "/follow@ForemanBot 0x…" in a group
	const command = rawCommand.toLowerCase().replace(/@\w+$/, "");
	switch (command) {
		case "/start":
			return arg ? follow(deps, chatId, arg) : HELP;
		case "/follow":
			return arg
				? follow(deps, chatId, arg)
				: "Send /follow and an address: /follow 0x…";
		case "/unfollow": {
			const address = toAddress(arg);
			if (!address) return "Send /unfollow and an address: /unfollow 0x…";
			return (await unfollowAddress(deps.pool, chatId, address))
				? `Stopped following ${shortAddress(address)}.`
				: `This chat doesn't follow ${shortAddress(address)}.`;
		}
		case "/list": {
			const follows = await readFollows(deps.pool, chatId);
			if (follows.length === 0) {
				return "This chat follows no address. Send /follow 0x… to start.";
			}
			return ["This chat follows:", ...follows.map((f) => f.address)].join(
				"\n",
			);
		}
		case "/pro":
			return pro(deps, chatId);
		case "/stop":
			await stopChat(deps.pool, chatId);
			return "Stopped. Foreman has forgotten this chat's follows. Send /follow 0x… to start again.";
		default:
			return HELP;
	}
}

async function follow(
	deps: BotDeps,
	chatId: bigint,
	arg: string,
): Promise<string> {
	const address = toAddress(arg);
	if (!address)
		return `"${arg.slice(0, 50)}" isn't an address. Send /follow 0x… with a 0x address.`;
	const at = await marketRead(deps.pool);
	const limit = await followLimit(deps.pool, chatId, deps.now());
	const outcome = await followAddress(deps.pool, {
		chatId,
		address,
		atBlock: at.block,
		limit,
	});
	const who = shortAddress(address);
	switch (outcome.status) {
		case "followed":
			return `Following ${who}. Foreman will send a message when a copy of one of its miners is listed on TapeOut's market. Copies already listed aren't sent.`;
		case "already":
			return `This chat already follows ${who}.`;
		case "limit":
			return outcome.limit === FREE_FOLLOWS
				? `This chat already follows ${FREE_FOLLOWS} address, the most without Foreman Pro. Send /pro to follow up to ${PRO_FOLLOWS}, or /unfollow 0x… first.`
				: `This chat already follows ${outcome.limit} addresses, the most it can. Send /unfollow 0x… first.`;
	}
}

/** The chat's Pro: until when, or when it ended, and the pay link. A payment is a test payment. */
async function pro(deps: BotDeps, chatId: bigint): Promise<string> {
	const until = await readProUntil(deps.pool, chatId);
	const active = until !== null && until.getTime() > deps.now();
	const limit = active ? PRO_FOLLOWS : FREE_FOLLOWS;
	const n = (await readFollows(deps.pool, chatId)).length;
	const follows = `This chat follows ${n} of ${limit} ${limit === 1 ? "address" : "addresses"}.`;
	const terms = `0.01 test OKB on the X Layer testnet: a test payment, as the real price isn't set.`;
	const link = await payLink(deps, chatId);
	if (active) {
		return [
			`Foreman Pro until ${formatDay(until)}. ${follows}`,
			"",
			`Paying again adds ${PRO_DAYS} days, for ${terms}`,
			link,
		].join("\n");
	}
	return [
		`${until ? `Foreman Pro ended on ${formatDay(until)}. ` : ""}${follows}`,
		"",
		`Foreman Pro lets a chat follow up to ${PRO_FOLLOWS} addresses for ${PRO_DAYS} days, for ${terms} Anyone can pay for this chat with this link:`,
		link,
	].join("\n");
}

function toAddress(arg: string) {
	try {
		return parseAddress(arg.toLowerCase(), "address");
	} catch {
		return null;
	}
}
