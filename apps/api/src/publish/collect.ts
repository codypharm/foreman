// Which circuits get a result, and building them (docs/decisions/2026-11-21-publish-job.md, "Which
// circuits"): every miner in the index ("miner"), and every circuit with an open listing on
// TapeOut's circuit market that isn't a miner ("listed"). A circuit whose result can't be built is
// skipped with its reason, never published.

import type { Originality } from "@foreman/contract";
import { readMarketBook, readMiners } from "@foreman/index";
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

/** Builds every target's result, `concurrency` at a time, in the targets' order. */
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
