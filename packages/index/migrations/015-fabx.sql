-- FabX on X Layer, in its own tables (docs/decisions/2026-11-25-fabx-storage.md). The BNB Chain
-- tables above are not changed. Everything here comes from FabX's processor and FabX's mining
-- contract (CLAUDE.md, "On-chain facts"), read from X Layer (chain 196).

-- One row per tape-out on FabX's processor, from its TapedOut event, with its block's time.
-- Netlist columns as on circuits (002-netlists.sql): null status = not read yet.
create table xlayer_circuits (
	processor text not null check (processor ~ '^0x[0-9a-f]{40}$'),
	id numeric(78, 0) not null check (id > 0),
	taped_out_block bigint not null,
	taped_out_tx integer not null,
	taped_out_log integer not null,
	taped_out_time bigint not null check (taped_out_time > 0),
	taped_out_by text not null check (taped_out_by ~ '^0x[0-9a-f]{40}$'),
	netlist_status text check (netlist_status in ('read', 'unreadable')),
	netlist_read_at_block bigint,
	netlist_detail text,
	n_in integer,
	n_out integer,
	n_state integer,
	gate_count integer,
	netlist bytea,
	netlist_hash bytea check (octet_length(netlist_hash) = 32),
	byte_hash bytea check (octet_length(byte_hash) = 32),
	hash_rule text,
	primary key (processor, id),
	unique (taped_out_block, taped_out_tx, taped_out_log),
	constraint xlayer_netlist_read_complete check (
		(netlist_status is null and netlist_read_at_block is null)
		or (netlist_status = 'unreadable' and netlist_read_at_block is not null and netlist_detail is not null)
		or (netlist_status = 'read' and netlist_read_at_block is not null and n_in is not null
			and n_out is not null and n_state is not null and gate_count is not null and netlist is not null
			and netlist_hash is not null and byte_hash is not null and hash_rule is not null)
	)
);

create index xlayer_circuits_unread on xlayer_circuits (taped_out_block, taped_out_tx, taped_out_log)
	where netlist_status is null;
create index xlayer_circuits_netlist_hash on xlayer_circuits (netlist_hash);

-- Every DesignCommitted event FabX's mining contract emitted. claimed_block is the event's own
-- block field: it equals block for a commitment made in that block, and is earlier for the 4,089
-- migrated on 14 Oct 2026, which never confirm a commitment (2026-11-25-fabx-commitment-designer.md).
create table fabx_design_commitments (
	block bigint not null,
	tx integer not null,
	log integer not null,
	tx_hash bytea not null check (octet_length(tx_hash) = 32),
	block_time bigint not null check (block_time > 0),
	commitment bytea not null check (octet_length(commitment) = 32),
	designer text not null check (designer ~ '^0x[0-9a-f]{40}$'),
	circuits text not null check (circuits ~ '^0x[0-9a-f]{40}$'),
	claimed_block bigint not null,
	first_unused_id numeric(78, 0) not null,
	primary key (block, tx, log)
);

create index fabx_design_commitments_block on fabx_design_commitments (block);

-- Every Started event FabX's mining contract emitted for a circuit, to know who started it.
create table fabx_starts (
	block bigint not null,
	tx integer not null,
	log integer not null,
	key bytea not null check (octet_length(key) = 32),
	processor text not null check (processor ~ '^0x[0-9a-f]{40}$'),
	id numeric(78, 0) not null check (id > 0),
	registrant text not null check (registrant ~ '^0x[0-9a-f]{40}$'),
	primary key (block, tx, log)
);

create index fabx_starts_circuit on fabx_starts (processor, id);

-- FabX's contract changes and settings (2026-11-25-fabx-copy-check.md, decision 6): Upgraded,
-- OwnershipTransferred and ProcessorSet freeze FabX results when after the reviewed block below;
-- Paused, Unpaused and BoostSet are only followed. detail holds the event's fields as text.
create table fabx_contract_events (
	block bigint not null,
	tx integer not null,
	log integer not null,
	tx_hash bytea not null check (octet_length(tx_hash) = 32),
	block_time bigint not null check (block_time > 0),
	kind text not null check (kind in
		('Upgraded', 'OwnershipTransferred', 'ProcessorSet', 'Paused', 'Unpaused', 'BoostSet')),
	detail jsonb not null,
	primary key (block, tx, log)
);

-- One row per circuit on FabX's processor that FabX's getMiner knows (status above 0), as last
-- read. A commitment is confirmed once, by the event it rests on, and never read again
-- (decision 5): commitment_status 'none' = no commitment block; 'confirmed' = the event at
-- confirmed_by_*; 'unconfirmed' = no such event.
create table fabx_miners (
	processor text not null check (processor ~ '^0x[0-9a-f]{40}$'),
	id numeric(78, 0) not null check (id > 0),
	key bytea not null unique check (octet_length(key) = 32),
	status smallint not null check (status between 1 and 3),
	registrant text not null check (registrant ~ '^0x[0-9a-f]{40}$'),
	task_id integer not null,
	commit_block bigint not null check (commit_block >= 0),
	first_unused_id numeric(78, 0) not null,
	read_at_block bigint not null,
	commitment_status text not null check (commitment_status in ('none', 'confirmed', 'unconfirmed')),
	confirmed_by_block bigint,
	confirmed_by_tx integer,
	confirmed_by_log integer,
	commitment_time bigint check (commitment_time > 0),
	primary key (processor, id),
	foreign key (confirmed_by_block, confirmed_by_tx, confirmed_by_log)
		references fabx_design_commitments (block, tx, log),
	check (
		(commitment_status = 'none' and commit_block = 0 and confirmed_by_block is null and commitment_time is null)
		or (commitment_status = 'unconfirmed' and commit_block > 0 and confirmed_by_block is null and commitment_time is null)
		or (commitment_status = 'confirmed' and commit_block > 0 and confirmed_by_block = commit_block
			and confirmed_by_tx is not null and confirmed_by_log is not null and commitment_time is not null)
	)
);

-- How far FabX's history is read, the reviewed state of its mining contract, and whether FabX
-- results are frozen. One row, or none before the first save.
--   logs_up_to_block: every log of FabX's processor and mining contract is stored up to here.
--   miners_read_at_block: the block fabx_miners was last read at.
--   reviewed_implementation / reviewed_at_block: the code William reviewed, and the block from
--     which a freezing event counts. Only William changes them (decision 6).
--   frozen_at_block: the first freezing event after reviewed_at_block, or null.
create table xlayer_state (
	only_row boolean primary key default true check (only_row),
	logs_up_to_block bigint not null,
	miners_read_at_block bigint,
	reviewed_implementation text not null check (reviewed_implementation ~ '^0x[0-9a-f]{40}$'),
	reviewed_at_block bigint not null,
	frozen_at_block bigint,
	check (frozen_at_block is null or frozen_at_block > reviewed_at_block)
);
