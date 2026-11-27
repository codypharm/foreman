-- Each key's last 4 characters, so the API page can say which key a wallet has
-- (docs/decisions/2026-11-27-key-ending.md). Keys made before this have only their hash, and the
-- ending can't be worked out from it, so theirs stays null.
alter table api_keys add column key_ending text
	check (key_ending is null or key_ending ~ '^[A-Za-z0-9_-]{4}$');
