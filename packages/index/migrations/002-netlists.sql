-- Each circuit's netlist, counts and hashes, filled in by the netlist backfill
-- (docs/decisions/2026-11-20-circuit-index.md, decision 4). Netlists can't change once taped
-- out, so each circuit is read once.
--
-- netlist_status: null = not read yet; 'read' = stored below; 'unreadable' = the chain returned
-- a netlist that doesn't decode, shown as "Can't check", never as "No earlier copy found".
-- A failed RPC read stores nothing, so the next run tries again.
alter table circuits
	add column netlist_status text check (netlist_status in ('read', 'unreadable')),
	add column netlist_read_at_block bigint,
	add column netlist_detail text,
	add column n_in integer,
	add column n_out integer,
	add column n_state integer,
	add column gate_count integer,
	add column netlist bytea,
	add column netlist_hash bytea check (octet_length(netlist_hash) = 32),
	add column byte_hash bytea check (octet_length(byte_hash) = 32),
	add column hash_rule text,
	add constraint netlist_read_complete check (
		(netlist_status is null and netlist_read_at_block is null)
		or (netlist_status = 'unreadable' and netlist_read_at_block is not null and netlist_detail is not null)
		or (netlist_status = 'read' and netlist_read_at_block is not null and n_in is not null
			and n_out is not null and n_state is not null and gate_count is not null and netlist is not null
			and netlist_hash is not null and byte_hash is not null and hash_rule is not null)
	);

-- The backfill picks unread circuits in tape-out order.
create index circuits_unread on circuits (taped_out_block, taped_out_tx, taped_out_log)
	where netlist_status is null;

-- Finding copies: every circuit with the same netlist hash.
create index circuits_netlist_hash on circuits (netlist_hash);
