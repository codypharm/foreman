-- The order a chat followed its addresses in, so "the first address followed" is exact when two
-- follows share a market block: without Foreman Pro only that one sends
-- (docs/decisions/2026-11-26-pro-payments.md, decision 6). Follows made before this migration are
-- numbered in the order Postgres returns them.
alter table telegram_follows add column follow_order bigserial;
