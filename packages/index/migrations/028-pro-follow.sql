-- The worker's backup read of ForemanPro's Paid events (docs/decisions/2026-11-26-pro-payments.md,
-- decision 5): the X Layer testnet block it has read up to. One row; none before the first read.
create table pro_follow (
	one boolean primary key default true check (one),
	up_to_block bigint not null
);
