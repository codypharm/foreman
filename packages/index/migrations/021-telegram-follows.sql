-- Telegram chats following addresses for copy alerts, and the listings already sent to each chat
-- (docs/decisions/2026-11-23-copy-alert-notifications.md, decisions 3 and 10;
-- 2026-11-26-telegram-alerts-for-pro.md, decision 2). Only the chat id, the address, the block it
-- was followed at and which listings were sent are kept: no names, no messages.
create table telegram_follows (
	chat_id bigint not null,
	address text not null check (address ~ '^0x[0-9a-f]{40}$'),
	followed_at_block bigint not null,
	primary key (chat_id, address)
);

create table telegram_sent (
	chat_id bigint not null,
	listing_id bigint not null,
	primary key (chat_id, listing_id)
);
