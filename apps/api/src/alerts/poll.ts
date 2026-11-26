// The bot's command loop (docs/decisions/2026-11-23-copy-alert-notifications.md, decision 5): it
// long-polls Telegram, so it needs no public webhook and runs inside the worker. Each update is
// acknowledged by asking for the next one; a reply that fails is logged and never stops the loop.
// Messages are never logged: only chat ids and counts.

import { type BotDeps, handleCommand } from "./bot.ts";
import type { TelegramClient } from "./telegram.ts";

const POLL_SECONDS = 30;
const RETRY_MS = 10_000;

export async function pollCommands(
	deps: BotDeps & { telegram: TelegramClient },
	signal: AbortSignal,
	log: (line: string) => void = console.log,
): Promise<void> {
	let offset = 0;
	while (!signal.aborted) {
		let updates: Awaited<ReturnType<TelegramClient["getUpdates"]>>;
		try {
			updates = await deps.telegram.getUpdates(offset, POLL_SECONDS, signal);
		} catch (error) {
			if (signal.aborted) return;
			log(
				`telegram: ${error instanceof Error ? error.message : String(error)}; trying again in 10 s`,
			);
			await new Promise((r) => setTimeout(r, RETRY_MS));
			continue;
		}
		for (const update of updates) {
			offset = Math.max(offset, update.updateId + 1);
			if (!update.message) continue;
			const { chatId, text } = update.message;
			try {
				const reply = await handleCommand(deps, chatId, text);
				const sent = await deps.telegram.sendMessage(chatId, reply);
				if (!sent.ok)
					log(`telegram: reply to chat ${chatId} not sent: ${sent.detail}`);
			} catch (error) {
				log(
					`telegram: chat ${chatId}'s command failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
}
