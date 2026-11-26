-- API keys for markets and lenders, and each key's calls per day (docs/decisions/2026-11-26-api-keys.md,
-- decisions 5 and 6). A key is shown once when it is made; only its SHA-256 hash is kept. The holder is
-- the name William gives it.
create table api_keys (
	id serial primary key,
	holder text not null,
	key_hash bytea not null unique,
	created_at timestamptz not null default now(),
	revoked_at timestamptz
);

create table api_usage (
	key_id integer not null references api_keys (id),
	day date not null,
	calls bigint not null,
	circuits bigint not null,
	primary key (key_id, day)
);
