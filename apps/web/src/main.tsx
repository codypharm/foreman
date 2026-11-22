import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { restoreTheme } from "./components/TopBar.tsx";
import "./styles/global.css";

restoreTheme();

const queryClient = new QueryClient({
	defaultOptions: {
		// The listings change every 5 minutes at most (the follow); errors are shown, not retried forever
		queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: true },
	},
});

const root = document.getElementById("root");
if (!root) throw new Error("No #root element in index.html");
createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</StrictMode>,
);
