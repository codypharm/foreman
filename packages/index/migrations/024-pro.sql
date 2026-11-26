-- Payments for Foreman Pro (docs/decisions/2026-11-26-pro-payments.md). Each Telegram chat's code,
-- made once and given in the bot's pay link; on chain it is the code padded to 32 bytes. Only the
-- chat id and its code are kept here.
create table telegram_pro_codes (
	chat_id bigint primary key,
	code bytea not null unique check (length(code) = 16)
);

-- Each ForemanPro Paid log counted, once (by transaction and log). chat_id is the chat whose code it
-- carried, or null for a code that is no chat's, kept so no payment is lost.
create table pro_payments (
	tx_hash bytea not null check (length(tx_hash) = 32),
	log_index integer not null,
	block bigint not null,
	paid_at timestamptz not null,
	code bytea not null check (length(code) = 32),
	payer text not null check (payer ~ '^0x[0-9a-f]{40}$'),
	amount numeric(78) not null,
	chat_id bigint,
	primary key (tx_hash, log_index)
);
create index pro_payments_chat on pro_payments (chat_id);
