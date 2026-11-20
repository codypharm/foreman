-- Daily network samples for the growth rates (docs/decisions/2026-11-20-growth-rates.md): the
-- network at the first block at or after 00:00 UTC each day, kept by the follow.
create table network_days (
	day bigint primary key check (day % 86400 = 0),
	block bigint not null,
	time bigint not null,
	verified_weight numeric(78, 0) not null check (verified_weight >= 0),
	unverified_weight numeric(78, 0) not null check (unverified_weight >= 0),
	miner_count numeric(78, 0) not null check (miner_count >= 0),
	verified_miner_count numeric(78, 0) not null check (verified_miner_count >= 0),
	-- The sample is read on its own day
	check (time >= day and time < day + 86400)
);
