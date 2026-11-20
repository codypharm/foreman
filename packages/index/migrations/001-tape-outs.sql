-- The tape-out scan's results (docs/decisions/2026-11-20-circuit-index.md, decisions 2 and 4).
-- Netlists, hashes and design commitments come in later migrations.

-- Every processor the factory listed, with the last id it had issued (nextId()) when read.
create table processors (
	address text primary key check (address ~ '^0x[0-9a-f]{40}$'),
	issued numeric(78, 0) not null check (issued >= 0),
	read_at_block bigint not null
);

-- One row per tape-out, from its TapedOut event. Ids are uint256 on chain.
create table circuits (
	processor text not null references processors (address),
	id numeric(78, 0) not null check (id > 0),
	taped_out_block bigint not null,
	taped_out_tx integer not null,
	taped_out_log integer not null,
	taped_out_by text not null check (taped_out_by ~ '^0x[0-9a-f]{40}$'),
	primary key (processor, id),
	unique (taped_out_block, taped_out_tx, taped_out_log)
);

-- The block the index is complete up to: one row, or none before the first scan is saved.
create table index_state (
	only_row boolean primary key default true check (only_row),
	up_to_block bigint not null
);
