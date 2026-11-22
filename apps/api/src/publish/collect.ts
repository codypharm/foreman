// Which circuits get a result, and their results (docs/decisions/2026-11-21-publish-job.md, "Which
// circuits"): every miner in the index ("miner"), and every circuit with an open listing on
// TapeOut's circuit market that isn't a miner ("listed"). Their results are the stored ones the
// pages read, never built here, so a page and a published result can't disagree
// (2026-11-21-stored-results.md; 2026-11-22-publish-from-stored-results.md). A circuit with no
// stored result is skipped with its reason, never published.

import type { Originality } from "@foreman/contract";
import {
	readAllStoredResults,
	readMarketBook,
	readMiners,
} from "@foreman/index";
import type { CircuitId } from "@foreman/originality";
import type pg from "pg";
import { buildResult, type ResultContext } from "../result.ts";

export interface Target {
	circuit: CircuitId;
	scope: "miner" | "listed";
}

export interface Skipped {
	circuit: CircuitId;
	detail: string;
}

export async function circuitsToPublish(pool: pg.Pool): Promise<Target[]> {
	const [miners, book] = await Promise.all([
		readMiners(pool),
		readMarketBook(pool),
	]);
	const seen = new Set<string>();
	const targets: Target[] = [];
	for (const m of miners.miners) {
		seen.add(name(m.circuit));
		targets.push({ circuit: m.circuit, scope: "miner" });
	}
	for (const l of book.open) {
		const circuit = { processor: l.processor, id: l.tokenId };
		if (seen.has(name(circuit))) continue;
		seen.add(name(circuit));
		targets.push({ circuit, scope: "listed" });
	}
	return targets;
}

/** Each target's stored result, in the targets' order; a target with none is skipped. */
export async function storedResultsToPublish(
	pool: pg.Pool,
): Promise<{ results: Originality[]; skipped: Skipped[] }> {
	const [targets, stored] = await Promise.all([
		circuitsToPublish(pool),
		readAllStoredResults(pool),
	]);
	const byCircuit = new Map(stored.map((s) => [name(s.circuit), s]));
	const results: Originality[] = [];
	const skipped: Skipped[] = [];
	for (const t of targets) {
		const s = byCircuit.get(name(t.circuit));
		if (s) results.push(s.originality);
		else
			skipped.push({
				circuit: t.circuit,
				detail: "no stored result yet: run the results job",
			});
	}
	return { results, skipped };
}

/** Builds every target's result (the results job, which fills the stored results), `concurrency` at a time, in the targets' order. */
export async function collectResults(
	ctx: ResultContext,
	targets: Target[],
	options: {
		concurrency: number;
		onProgress?: (done: number, of: number) => void;
	},
): Promise<{ results: Originality[]; skipped: Skipped[] }> {
	const results: Originality[] = [];
	const skipped: Skipped[] = [];
	for (let i = 0; i < targets.length; i += options.concurrency) {
		const chunk = targets.slice(i, i + options.concurrency);
		const reads = await Promise.all(
			chunk.map((t) => buildResult(ctx, t.circuit, t.scope)),
		);
		reads.forEach((read, j) => {
			const t = chunk[j] as Target;
			if (read.ok) results.push(read.originality);
			else skipped.push({ circuit: t.circuit, detail: read.detail });
		});
		options.onProgress?.(i + chunk.length, targets.length);
	}
	return { results, skipped };
}

const name = (c: CircuitId) => `${c.processor.toLowerCase()}/${c.id}`;
