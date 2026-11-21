-- What the publish job has written to a results contract on X Layer
-- (docs/decisions/2026-11-21-publish-job.md, decision 2). One row per circuit per contract, written
-- only after its transaction confirms; a republish replaces the row. Before each send the job
-- checks these rows against the contract's resultOf, so the chain stays the authority.
create table published_results (
	chain_id integer not null check (chain_id in (196, 1952)),
	contract text not null check (contract ~ '^0x[0-9a-f]{40}$'),
	key bytea not null check (octet_length(key) = 32),
	processor text not null check (processor ~ '^0x[0-9a-f]{40}$'),
	id numeric(78, 0) not null check (id > 0),
	kind smallint not null check (kind between 1 and 5),
	can_mine smallint not null check (can_mine between 1 and 4),
	fingerprint bytea not null check (octet_length(fingerprint) = 32),
	result_hash bytea not null check (octet_length(result_hash) = 32),
	index_block bigint not null check (index_block > 0),
	tx text not null check (tx ~ '^0x[0-9a-f]{64}$'),
	block bigint not null check (block > 0),
	primary key (chain_id, contract, key)
);
