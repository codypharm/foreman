-- The second an unconfirmed FabX commitment claims: the timestamp of the X Layer block its
-- commitBlock names, read from X Layer (2026-11-25-cross-chain-check.md, decision 3). It never
-- sets the order; the copy check counts it only to find the results it would change, which are
-- Can't check. Unconfirmed commitments only; cleared when the commitment's block changes.
alter table fabx_miners add column claimed_time bigint check (claimed_time > 0);
alter table fabx_miners add constraint fabx_claimed_time_unconfirmed
	check (claimed_time is null or commitment_status = 'unconfirmed');
