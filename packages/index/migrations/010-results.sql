-- Every miner's and listed circuit's result, built by the results job and read by the API and the
-- publish job (docs/decisions/2026-11-21-stored-results.md). One row per circuit; a rebuild
-- replaces it, a failed build leaves the last complete one. The result is the Originality's wire
-- JSON, exactly as serialiseOriginality writes it, so a reader parses and re-checks it.
create table circuit_results (
	processor text not null check (processor ~ '^0x[0-9a-f]{40}$'),
	id numeric(78, 0) not null check (id > 0),
	scope text not null check (scope in ('miner', 'listed')),
	kind text not null check (kind in ('no-earlier-copy', 'copy', 'too-small-to-tell', 'wrapper', 'cant-check')),
	can_mine text not null check (can_mine in ('mining', 'cant-mine', 'stopped', 'not-started')),
	originality text not null,
	index_block bigint not null check (index_block > 0),
	built_at bigint not null check (built_at > 0),
	primary key (processor, id)
);

create index circuit_results_kind on circuit_results (kind);

-- The index block the last rebuild of changes, and the last full rebuild, covered; and when the
-- full one ran (Unix seconds)
alter table index_state add column results_changes_up_to_block bigint;
alter table index_state add column results_full_up_to_block bigint;
alter table index_state add column results_full_at bigint;
