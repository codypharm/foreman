-- A key made on the For markets page belongs to the wallet that signed for it, and a wallet has at most
-- one live key (docs/decisions/2026-11-26-self-serve-api-keys.md, decisions 2 and 3). Keys William
-- makes by hand have no wallet.
alter table api_keys add column wallet text check (wallet ~ '^0x[0-9a-f]{40}$');

create unique index api_keys_one_live_per_wallet on api_keys (wallet)
	where wallet is not null and revoked_at is null;

-- The time inside the message the wallet signed: a key is made only from a message newer than the
-- wallet's last one, so a signed message can't be sent again to make another key.
alter table api_keys add column signed_at timestamptz;
