import { defineConfig } from "vitest/config";

// Storage tests need TEST_DATABASE_URL; read it from the root .env when there is one.
try {
	process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {}

export default defineConfig({ test: {} });
