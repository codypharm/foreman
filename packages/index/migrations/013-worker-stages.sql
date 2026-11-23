-- Each worker stage's last outcome (docs/decisions/2026-11-23-hosting.md, decisions 2 and 7), written
-- by the worker after every run and read by GET /health. Times are unix seconds. A stage that has
-- never had an outcome has no row.
create table worker_stages (
	stage text primary key check (stage in ('follow', 'refresh', 'publish')),
	last_done_at bigint,
	last_done_summary text,
	last_skipped_at bigint,
	last_skipped_summary text,
	last_failed_at bigint,
	last_failed_detail text
);
