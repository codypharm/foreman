// Hash routes until DeWEB's path handling is checked (docs/decisions/2026-11-22-web-scaffold.md).

import { Route, Router, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { TopBar } from "./components/TopBar.tsx";
import { ListingsPage } from "./pages/ListingsPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";

export function App() {
	return (
		<Router hook={useHashLocation}>
			<TopBar />
			<Switch>
				<Route path="/" component={ListingsPage} />
				<Route component={NotFound} />
			</Switch>
		</Router>
	);
}
