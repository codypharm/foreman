-- Each circuit's current holder on the two eligible processors, from their ERC-721 Transfer events
-- (docs/decisions/2026-11-21-api-endpoints.md, decision 5; 2026-11-22-wallet-miners.md), with where
-- it last changed hands. A miner held for a RIG voucher shows its rig vault cell here; the wallet
-- page reaches it through the voucher holder.
create table circuit_owners (
	processor text not null,
	id numeric(78, 0) not null,
	owner text not null check (owner ~ '^0x[0-9a-f]{40}$'),
	block bigint not null,
	tx_index integer not null,
	log_index integer not null,
	primary key (processor, id),
	foreign key (processor, id) references circuits (processor, id)
);
create index circuit_owners_owner on circuit_owners (owner);

-- The block Transfer events are read up to: null before the first owner scan is saved.
alter table index_state add column owners_up_to_block bigint;
