-- Times for tape-outs and design commitments (docs/decisions/2026-11-20-originality-result.md,
-- decision 1). Each is its block's own timestamp in Unix seconds, so a result stays reproducible.
--
-- taped_out_time comes from the TapedOut log's blockTimestamp. It is null only for rows saved
-- before this migration, until they are filled once; every scan saved after it writes the time.
alter table circuits add column taped_out_time bigint check (taped_out_time > 0);

-- design_committed_time is the commitment block's time, read with the commitment. It is null
-- when there is no commitment, and for commitments read before this migration until filled.
alter table miners add column design_committed_time bigint check (design_committed_time > 0);
alter table miners add constraint miners_commitment_time_has_block
	check (design_committed_time is null or design_committed_at is not null);
