// One run of the hosted worker (docs/decisions/2026-11-23-hosting.md, decision 2): follow the index,
// refresh the results it touched, publish what changed. In that order, because each reads what the
// one before wrote. The first stage that fails ends the run: nothing after it runs on a half-read
// index, and the next run, 5 minutes later, starts again from the follow. That next run is the
// retry; nothing here loops.

export type StageName = "follow" | "refresh" | "publish";

export type StageOutcome =
	/** Done. `summary` is one plain line for the log: blocks, counts, transaction hashes, never a key. */
	| { status: "done"; summary: string; warnings?: string[] }
	/** Chose not to run, which is not a failure: no publisher key set, say. */
	| { status: "skipped"; summary: string }
	| { status: "failed"; detail: string };

export type Stage = () => Promise<StageOutcome>;

export interface CycleReport {
	/** Every stage that ran, in order, with its outcome. Stages after a failure are absent. */
	stages: { name: StageName; outcome: StageOutcome }[];
	/** Whether every stage that ran finished without failing. */
	ok: boolean;
}

const ORDER: StageName[] = ["follow", "refresh", "publish"];

export async function runCycle(
	stages: Record<StageName, Stage>,
	log: (line: string) => void = console.log,
): Promise<CycleReport> {
	const report: CycleReport = { stages: [], ok: true };
	for (const name of ORDER) {
		const stage = stages[name];
		let outcome: StageOutcome;
		try {
			outcome = await stage();
		} catch (error) {
			// A thrown read (an RPC down, the database gone) is a failure with its message, never a crash
			outcome = {
				status: "failed",
				detail: error instanceof Error ? error.message : String(error),
			};
		}
		report.stages.push({ name, outcome });
		if (outcome.status === "failed") {
			log(`${name}: failed: ${outcome.detail}`);
			const left = ORDER.slice(ORDER.indexOf(name) + 1);
			if (left.length)
				log(`  not run: ${left.join(", ")}; the next run starts again`);
			report.ok = false;
			return report;
		}
		log(
			`${name}: ${outcome.status === "skipped" ? "skipped: " : ""}${outcome.summary}`,
		);
		if (outcome.status === "done") {
			for (const w of outcome.warnings ?? []) log(`  ${w}`);
		}
	}
	return report;
}
