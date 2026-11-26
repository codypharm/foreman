-- Foreman Pro's reminders sent to each chat, one of each kind per end date, so a renewal (a new end)
-- gets its own (docs/decisions/2026-11-26-pro-payments.md, decision 6).
create table telegram_pro_reminders (
	chat_id bigint not null,
	pro_until timestamptz not null,
	kind text not null check (kind in ('ending', 'ended')),
	primary key (chat_id, pro_until, kind)
);
