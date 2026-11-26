-- The worker's backup read of Foreman Pro payments is a stage of its own, recorded for GET /health
-- like the others (docs/decisions/2026-11-26-pro-payments.md, decision 5).
alter table worker_stages drop constraint worker_stages_stage_check;
alter table worker_stages add constraint worker_stages_stage_check
	check (stage in ('pro', 'follow', 'fabx', 'refresh', 'publish'));
