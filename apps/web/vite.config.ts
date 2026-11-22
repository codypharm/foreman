// The web app builds to plain static files for DeWEB (docs/decisions/2026-11-18-frontend.md). No secrets:
// VITE_API_URL is the public address of the Foreman API.
import { defineConfig } from "vite";

export default defineConfig({
	server: { port: 5173, strictPort: true },
	build: { target: "es2023" },
});
