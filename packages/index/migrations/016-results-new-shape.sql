-- Stored results are in the Originality shape from before 25 Nov 2026 (index.upToBlock, no
-- mining), which parseOriginality no longer reads (2026-11-25-fabx-copy-check.md; 2026-11-25-
-- republish-in-new-shape.md). They are derived data: clearing them and the refresh state makes the
-- next results run rebuild every result in today's shape, as on a fresh database. The record of
-- what was published (published_results) stays.
delete from circuit_results;
update index_state set
	results_changes_up_to_block = null,
	results_full_up_to_block = null,
	results_full_at = null;
