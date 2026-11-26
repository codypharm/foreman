-- When the bot told a chat its Foreman Pro payment counted (docs/decisions/2026-11-26-pro-payments.md,
-- decision 5); null until then. A payment that is no chat's is never told.
alter table pro_payments add column told_at timestamptz;
