// Hash routes until DeWEB's path handling is checked (docs/decisions/2026-11-22-web-scaffold.md).

import { Redirect, Route, Router, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { TopBar } from "./components/TopBar.tsx";
import { ListingsPage } from "./pages/ListingsPage.tsx";
import { MarketsPage } from "./pages/markets/MarketsPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { ProPage } from "./pages/pro/ProPage.tsx";
import { ResultPage } from "./pages/result/ResultPage.tsx";
import { WalletPage } from "./pages/wallet/WalletPage.tsx";

export function App() {
	return (
		<Router hook={useHashLocation}>
			<TopBar />
			<Switch>
				<Route path="/" component={ListingsPage} />
				<Route path="/circuit/:processor/:tokenId">
					{(p) => <ResultPage key={`${p.processor}/${p.tokenId}`} {...p} />}
				</Route>
				<Route path="/wallet" component={WalletPage} />
				<Route path="/api" component={MarketsPage} />
				<Route path="/pro/:code?" component={ProPage} />
				{/* The page was "For markets" at #/markets until 26 Nov 2026 */}
				<Route path="/markets">
					<Redirect to="/api" replace />
				</Route>
				<Route component={NotFound} />
			</Switch>
		</Router>
	);
}
