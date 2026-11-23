-- The publisher wallet's balance (docs/decisions/2026-11-23-low-balance-warning.md), read by the
-- worker on every publish run and shown by GET /health. One row per chain, the latest read. The
-- balance is in wei (18 decimals); read_at is unix seconds. No row means it was never read.
create table publisher_balance (
	chain_id integer primary key,
	address text not null,
	balance_wei numeric(78, 0) not null check (balance_wei >= 0),
	read_at bigint not null
);
