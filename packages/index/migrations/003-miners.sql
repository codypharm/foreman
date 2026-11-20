-- Miners and their design commitments (docs/decisions/2026-11-20-circuit-index.md, decision 4).
-- One row per miner key, from the mining contract's Started events. A miner's design commitment
-- block is read from getMiner; a restart can bring a new commitment, so a new start clears it
-- and the commitment backfill reads it again.
--
-- commitment_status: null = not read (or started again since); 'read' = design_committed_at
-- holds the block, or null when the miner started without a commitment.
create table miners (
	key bytea primary key check (octet_length(key) = 32),
	processor text not null check (processor ~ '^0x[0-9a-f]{40}$'),
	id numeric(78, 0) not null check (id > 0),
	first_started_block bigint not null,
	last_started_block bigint not null,
	last_started_tx integer not null,
	last_started_log integer not null,
	starts integer not null check (starts > 0),
	commitment_status text check (commitment_status in ('read')),
	commitment_read_at_block bigint,
	design_committed_at bigint,
	unique (processor, id),
	check (
		(commitment_status is null and commitment_read_at_block is null and design_committed_at is null)
		or (commitment_status = 'read' and commitment_read_at_block is not null)
	)
);

create index miners_commitment_unread on miners (first_started_block) where commitment_status is null;

-- The block the miner starts are read up to: null before the first miner scan is saved.
alter table index_state add column miners_up_to_block bigint;
