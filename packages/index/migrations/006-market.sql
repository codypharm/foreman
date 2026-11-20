-- The market index (docs/decisions/2026-11-20-market-index.md): every sale on TapeOut's circuit
-- market, and every listing ever made, kept current by the follow.

-- One row per Sold event. The sold miner's state is read at the block before the sale, for sales
-- inside the state window when they were indexed; older sales have none and are never comparables.
create table market_sales (
	block bigint not null,
	log_index integer not null,
	tx text not null check (tx ~ '^0x[0-9a-f]{64}$'),
	time bigint not null check (time > 0),
	listing_id numeric(78, 0) not null check (listing_id > 0),
	processor text not null check (processor ~ '^0x[0-9a-f]{40}$'),
	token_id numeric(78, 0) not null,
	buyer text not null check (buyer ~ '^0x[0-9a-f]{40}$'),
	price_wei numeric(78, 0) not null check (price_wei > 0),
	fee_wei numeric(78, 0) not null check (fee_wei >= 0),
	miner_status smallint check (miner_status between 0 and 3),
	miner_task_id integer,
	miner_verif_weight numeric(78, 0),
	miner_unver_weight numeric(78, 0),
	primary key (block, log_index),
	constraint market_sales_miner_whole check (
		(miner_status is null and miner_task_id is null and miner_verif_weight is null and miner_unver_weight is null)
		or (miner_status is not null and miner_task_id is not null and miner_verif_weight is not null and miner_unver_weight is not null)
	)
);

create index market_sales_time on market_sales (time);

-- One row per listing id ever issued, as read at read_at_block: open with its ask, or closed (sold
-- or withdrawn). An open listing's miner and whether it can be bought are read again every follow.
create table market_listings (
	listing_id numeric(78, 0) primary key check (listing_id > 0),
	read_at_block bigint not null,
	open boolean not null,
	seller text check (seller ~ '^0x[0-9a-f]{40}$'),
	processor text check (processor ~ '^0x[0-9a-f]{40}$'),
	token_id numeric(78, 0),
	price_wei numeric(78, 0) check (price_wei > 0),
	fee_bps integer check (fee_bps between 0 and 10000),
	state_read_at_block bigint,
	buyable boolean,
	miner_status smallint check (miner_status between 0 and 3),
	miner_task_id integer,
	miner_verif_weight numeric(78, 0),
	miner_unver_weight numeric(78, 0),
	constraint market_listings_ask_whole check (
		(not open and seller is null and processor is null and token_id is null and price_wei is null and fee_bps is null)
		or (open and seller is not null and processor is not null and token_id is not null and price_wei is not null and fee_bps is not null)
	),
	constraint market_listings_state_whole check (
		(state_read_at_block is null and buyable is null and miner_status is null and miner_task_id is null
			and miner_verif_weight is null and miner_unver_weight is null)
		or (open and state_read_at_block is not null and buyable is not null and miner_status is not null
			and miner_task_id is not null and miner_verif_weight is not null and miner_unver_weight is not null)
	)
);

create index market_listings_open on market_listings (listing_id) where open;

-- The block and time the market is read up to: null before the first fill.
alter table index_state add column market_up_to_block bigint;
alter table index_state add column market_up_to_time bigint;
