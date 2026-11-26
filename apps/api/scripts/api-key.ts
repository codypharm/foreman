// API keys for markets and lenders (docs/decisions/2026-11-26-api-keys.md, decision 5), run by
// William against the database the API reads. A new key is printed once and never stored or shown
// again: only its hash is kept. Needs DATABASE_URL.
//
//   pnpm --filter @foreman/api api-key create "<holder>"
//   pnpm --filter @foreman/api api-key revoke <id>
//   pnpm --filter @foreman/api api-key list

import {
	createApiKey,
	migrate,
	readApiKeys,
	revokeApiKey,
} from "@foreman/index";
import pg from "pg";

const [command, arg] = process.argv.slice(2);
const USAGE =
	'Usage: api-key create "<holder>" | api-key revoke <id> | api-key list';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	await migrate(pool);
	if (command === "create" && arg?.trim()) {
		const { id, key } = await createApiKey(pool, arg.trim());
		console.log(
			`Key ${id} for ${arg.trim()}. Shown once; Foreman keeps only its hash:\n\n${key}\n`,
		);
	} else if (command === "revoke" && /^\d+$/.test(arg ?? "")) {
		const done = await revokeApiKey(pool, Number(arg));
		console.log(done ? `Key ${arg} revoked.` : `No live key ${arg}.`);
	} else if (command === "list") {
		const keys = await readApiKeys(pool);
		if (keys.length === 0) console.log("No keys.");
		for (const k of keys) {
			const calls = k.days.reduce((n, d) => n + d.calls, 0);
			const circuits = k.days.reduce((n, d) => n + d.circuits, 0);
			const last = k.days.at(-1)?.day ?? "never";
			console.log(
				`${k.id}  ${k.holder}  ${k.revoked ? "revoked" : "live"}  made ${k.createdAt.toISOString().slice(0, 10)}  ${calls} calls, ${circuits} circuits, last used ${last}`,
			);
		}
	} else {
		console.error(USAGE);
		process.exitCode = 1;
	}
} finally {
	await pool.end();
}
