// The banner a page shows when it couldn't read Foreman: the API's own words with "Try again", or,
// when this tab's code is older than the API's (AppOutdated), why, with "Reload".

import { ApiProblem, AppOutdated } from "../api.ts";

export function ReadProblem({
	error,
	fallback,
	retry,
	className,
}: {
	error: Error | null;
	/** Said when the error carries no words of its own. */
	fallback: string;
	retry: () => void;
	className?: string | undefined;
}) {
	const outdated = error instanceof AppOutdated;
	return (
		<div className={className} role="alert">
			{outdated || error instanceof ApiProblem ? error.message : fallback}
			<br />
			<button
				type="button"
				onClick={outdated ? () => window.location.reload() : retry}
			>
				{outdated ? "Reload" : "Try again"}
			</button>
		</div>
	);
}
