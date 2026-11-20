-- Revoked miners (docs/decisions/2026-11-20-can-mine-revoked-and-stopped.md, decision 1). A revoke
-- is permanent, so a miner has at most one. The test vector and the block exist only in the
-- mining contract's Revoked event, read by the revoke scan.
alter table miners add column revoked_block bigint;
alter table miners add column revoked_tx integer;
alter table miners add column revoked_log integer;
alter table miners add column revoked_vector integer check (revoked_vector >= 0);
alter table miners add constraint miners_revoke_complete check (
	(revoked_block is null and revoked_tx is null and revoked_log is null and revoked_vector is null)
	or (revoked_block is not null and revoked_tx is not null and revoked_log is not null and revoked_vector is not null)
);

-- The block Revoked events are read up to: null before the first revoke scan is saved.
alter table index_state add column revokes_up_to_block bigint;
