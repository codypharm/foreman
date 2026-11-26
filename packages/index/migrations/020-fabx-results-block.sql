-- The X Layer block FabX's stored results were last rebuilt at, so a rebuild of changes knows
-- which FabX circuits are new since (2026-11-26-fabx-follow.md). Null before the first rebuild
-- with FabX, and left in place while FabX is frozen.
alter table xlayer_state add column results_up_to_block bigint;
