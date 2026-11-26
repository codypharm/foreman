// A small client for Telegram's Bot API (docs/decisions/2026-11-23-copy-alert-notifications.md,
// decisions 5 and 6): long polling for commands and sending plain-text messages. The bot token is
// part of every request URL, so no URL, request or response body is ever logged or put in an error.

export interface TelegramUpdate {
	updateId: number;
	/** The chat a text message came from, and its text; null for anything else. */
	message: { chatId: bigint; text: string } | null;
}

export type SendResult =
	| { ok: true }
	/** blocked: the chat blocked the bot or no longer exists, so its follows are deleted. */
	| { ok: false; blocked: boolean; detail: string };

export interface TelegramClient {
	getUpdates(
		offset: number,
		timeoutSeconds: number,
		signal?: AbortSignal,
	): Promise<TelegramUpdate[]>;
	sendMessage(chatId: bigint, text: string): Promise<SendResult>;
}

interface Reply<T> {
	ok: boolean;
	result?: T;
	error_code?: number;
	description?: string;
}

export function telegramClient(
	token: string,
	fetchImpl: typeof fetch = fetch,
): TelegramClient {
	const call = async <T>(
		method: string,
		body: unknown,
		signal?: AbortSignal,
	): Promise<Reply<T>> => {
		let lastCode = "";
		// One retry after a second: a dropped connection is common and harmless to repeat for
		// these calls (a repeated getUpdates returns the same updates; a lost reply is rare)
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const response = await fetchImpl(
					`https://api.telegram.org/bot${token}/${method}`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
						...(signal ? { signal } : {}),
					},
				);
				return (await response.json()) as Reply<T>;
			} catch (error) {
				if (signal?.aborted) throw error;
				// fetch's own message can quote the URL, and with it the token: keep only the error code
				const cause = (error as { cause?: { code?: unknown } }).cause;
				lastCode = typeof cause?.code === "string" ? cause.code : "";
				if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
			}
		}
		throw new Error(
			`Telegram's ${method} couldn't be reached${lastCode ? ` (${lastCode})` : ""}`,
		);
	};

	return {
		async getUpdates(offset, timeoutSeconds, signal) {
			const reply = await call<
				{
					update_id: number;
					message?: { chat?: { id?: number }; text?: string };
				}[]
			>(
				"getUpdates",
				{ offset, timeout: timeoutSeconds, allowed_updates: ["message"] },
				signal,
			);
			if (!reply.ok || !reply.result) {
				throw new Error(
					`Telegram's getUpdates failed: ${reply.error_code ?? ""} ${reply.description ?? ""}`.trim(),
				);
			}
			return reply.result.map((u) => ({
				updateId: u.update_id,
				message:
					typeof u.message?.chat?.id === "number" &&
					typeof u.message.text === "string"
						? { chatId: BigInt(u.message.chat.id), text: u.message.text }
						: null,
			}));
		},

		async sendMessage(chatId, text) {
			const reply = await call("sendMessage", {
				chat_id: chatId.toString(),
				text,
				link_preview_options: { is_disabled: true },
			});
			if (reply.ok) return { ok: true };
			return {
				ok: false,
				// 403: blocked by the user or kicked; 400 "chat not found": the chat is gone
				blocked:
					reply.error_code === 403 ||
					/chat not found/i.test(reply.description ?? ""),
				detail: `${reply.error_code ?? ""} ${reply.description ?? ""}`.trim(),
			};
		},
	};
}
