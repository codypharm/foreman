-- When each listing was listed, and each open listing's miner weight without the design bonus
-- (docs/decisions/2026-11-21-api-endpoints.md; docs/data-contract.md, "API responses"). The follow
-- writes both from now on; listings indexed before this migration get their times from
-- fill-listing-times. The weight comes from the same getMiner read as the rest of the state.

alter table market_listings add column listed_block bigint check (listed_block > 0);
alter table market_listings add column listed_time bigint check (listed_time > 0);
alter table market_listings add constraint market_listings_listed_whole check (
	(listed_block is null) = (listed_time is null)
);

-- bstar × multiplier while mining, 0 otherwise; only with a state read
alter table market_listings add column miner_weight_without_bonus numeric(78, 0)
	check (miner_weight_without_bonus >= 0);
alter table market_listings add constraint market_listings_weight_with_state check (
	miner_weight_without_bonus is null or state_read_at_block is not null
);
