import { defineConfig } from "vitest/config";

// Storage tests need TEST_DATABASE_URL; read it from the root .env when there is one.
try {
	process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {}

// Every storage test file wipes the same test database, so files run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
