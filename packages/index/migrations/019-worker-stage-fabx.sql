-- The worker's FabX follow is a stage of its own, recorded for GET /health like the others
-- (docs/decisions/2026-11-26-fabx-follow.md, decision 4).
alter table worker_stages drop constraint worker_stages_stage_check;
alter table worker_stages add constraint worker_stages_stage_check
	check (stage in ('follow', 'fabx', 'refresh', 'publish'));
