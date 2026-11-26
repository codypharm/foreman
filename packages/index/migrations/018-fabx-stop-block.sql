-- The block a stopped FabX miner stopped at, from getMiner's stopBlock; null unless stopped
-- (status 3). A result shows it with no block it can start again from: FabX's cooldown is in
-- unverified code (2026-11-25-fabx-can-mine.md, decision 1). Stopped rows saved before this
-- column are removed and the miner read marked stale, so FabX's index doesn't load until its
-- miners are read again.
delete from fabx_miners where status = 3;
update xlayer_state set miners_read_at_block = null;
alter table fabx_miners add column stop_block bigint check (stop_block > 0);
alter table fabx_miners add constraint fabx_stop_block_when_stopped
	check ((status = 3) = (stop_block is not null));
