import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ApiProblem, AppOutdated, fetchCheck } from "../api.ts";
import s from "./TopBar.module.css";
import { WalletButton } from "./WalletButton.tsx";

const THEME_KEY = "foreman-theme";

/** The saved light or dark choice, if the browser lets us keep one. */
export function restoreTheme(): void {
	try {
		const saved = localStorage.getItem(THEME_KEY);
		if (saved === "light" || saved === "dark")
			document.documentElement.dataset.theme = saved;
	} catch {}
}

function toggleTheme(): void {
	const root = document.documentElement;
	const dark = root.dataset.theme
		? root.dataset.theme === "dark"
		: matchMedia("(prefers-color-scheme: dark)").matches;
	const next = dark ? "light" : "dark";
	root.dataset.theme = next;
	try {
		localStorage.setItem(THEME_KEY, next);
	} catch {}
}

export function TopBar() {
	const [location] = useLocation();
	return (
		<header className={s.top}>
			<Link href="/" className={s.mark} aria-label="Foreman, live listings">
				<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
					<rect x="1" y="1" width="9" height="9" rx="2" fill="currentColor" />
					<rect
						x="12"
						y="1"
						width="9"
						height="9"
						rx="2"
						fill="currentColor"
						opacity=".35"
					/>
					<rect
						x="1"
						y="12"
						width="9"
						height="9"
						rx="2"
						fill="currentColor"
						opacity=".35"
					/>
					<rect x="12" y="12" width="9" height="9" rx="2" fill="#C2F24B" />
				</svg>
				Foreman
			</Link>
			<CheckBox />
			<div className={s.right}>
				<nav className={s.nav}>
					<Link href="/" aria-current={location === "/" ? "page" : undefined}>
						Live listings
					</Link>
					<Link
						href="/wallet"
						aria-current={location.startsWith("/wallet") ? "page" : undefined}
					>
						My miners
					</Link>
					<Link
						href="/api"
						aria-current={location === "/api" ? "page" : undefined}
					>
						API
					</Link>
				</nav>
				<button
					type="button"
					className={s.icon}
					onClick={toggleTheme}
					aria-label="Switch light or dark"
				>
					<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
						<circle
							cx="9"
							cy="9"
							r="4"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.6"
						/>
						<path
							d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
						/>
					</svg>
				</button>
				<WalletButton />
			</div>
		</header>
	);
}

/**
 * The Check box: a listing number, RIG voucher, miner key, circuit or TapeOut's label (13931.30), resolved by the API to one
 * circuit, whose result page opens. What isn't found is said under the box, never guessed.
 */
function CheckBox() {
	const [, navigate] = useLocation();
	const [q, setQ] = useState("");
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	async function check(e: React.FormEvent) {
		e.preventDefault();
		if (!q.trim() || busy) return;
		setBusy(true);
		setProblem(null);
		try {
			const answer = await fetchCheck(q);
			navigate(`/circuit/${answer.processor}/${answer.tokenId}`);
		} catch (error) {
			setProblem(
				error instanceof ApiProblem
					? error.problem.error === "not-recognised"
						? "Paste a listing number (28074), a RIG voucher (RIG voucher #19), a miner key, a circuit (its processor, then its id) or TapeOut’s label (13931.30)."
						: error.problem.detail
					: error instanceof AppOutdated
						? error.message
						: "Something went wrong checking that.",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: the form is the search landmark; a <search> wrapper would add a box the layout doesn't need
		<form className={s.search} role="search" onSubmit={check}>
			<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<circle
					cx="7"
					cy="7"
					r="5"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
				/>
				<path
					d="M11 11l3.5 3.5"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
				/>
			</svg>
			<input
				aria-label="Listing, miner or RIG voucher"
				placeholder="Paste a listing, miner or RIG voucher"
				value={q}
				onChange={(e) => {
					setQ(e.target.value);
					setProblem(null);
				}}
				aria-describedby={problem ? "check-problem" : undefined}
				aria-invalid={problem ? true : undefined}
				spellCheck={false}
				autoComplete="off"
			/>
			<button type="submit" disabled={busy || !q.trim()}>
				{busy ? "Checking…" : "Check"}
			</button>
			{problem && (
				<p id="check-problem" className={s.problem} role="alert">
					{problem}
				</p>
			)}
		</form>
	);
}
