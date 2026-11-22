-- The network at the market's block, read by the market follow with its listings
-- (docs/decisions/2026-11-22-market-network.md): a listings page values each open listing's stored
-- weight against it, with no live read. Null until the first follow after this migration.
alter table index_state add column market_verified_weight numeric(78, 0) check (market_verified_weight >= 0);
alter table index_state add column market_unverified_weight numeric(78, 0) check (market_unverified_weight >= 0);
alter table index_state add column market_miner_count numeric(78, 0) check (market_miner_count >= 0);
alter table index_state add column market_verified_miner_count numeric(78, 0)
	check (market_verified_miner_count >= 0 and market_verified_miner_count <= market_miner_count);
alter table index_state add constraint index_state_market_network_whole check (
	(market_verified_weight is null and market_unverified_weight is null
		and market_miner_count is null and market_verified_miner_count is null)
	or (market_verified_weight is not null and market_unverified_weight is not null
		and market_miner_count is not null and market_verified_miner_count is not null
		and market_up_to_block is not null)
);
