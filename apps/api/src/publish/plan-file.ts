// The dry run's plan file (docs/decisions/2026-11-21-publish-job.md, decision 4). Each entry is
// kept as its logged bytes only; reading the file parses every one back into an Originality and
// derives its key, short verdict, fingerprint and hash again, so what `--send` stores on chain
// always matches what it logs. The publisher key is never in it.

import {
	type Address,
	ContractParseError,
	parseAddress,
	parseOriginality,
	parseUint,
} from "@foreman/contract";
import { type Hex, hexToString, isHex } from "viem";
import type { Skipped } from "./collect.ts";
import { type PlanEntry, planEntry } from "./plan.ts";

export interface PlanFile {
	chainId: 196 | 1952;
	/** The contract the plan was compared against; null when none is deployed on that chain yet. */
	contract: Address | null;
	/**
	 * The newest index block among the results. Each entry keeps its own, which goes on chain with
	 * it: stored results mix blocks between full rebuilds (2026-11-22-publish-from-stored-results.md).
	 */
	indexBlock: bigint;
	unchanged: number;
	skipped: Skipped[];
	/** Estimated gas per batch, or null when there was no contract to estimate against. */
	gas: bigint[] | null;
	entries: PlanEntry[];
}

export function serialisePlanFile(f: PlanFile): unknown {
	const byVerdict: Record<string, number> = {};
	for (const e of f.entries) {
		const v = parseOriginality(JSON.parse(hexToString(e.result)), "entry")
			.result.verdict;
		byVerdict[v] = (byVerdict[v] ?? 0) + 1;
	}
	return {
		chainId: f.chainId,
		contract: f.contract,
		indexBlock: f.indexBlock.toString(),
		unchanged: f.unchanged,
		byVerdict,
		skipped: f.skipped.map((s) => ({
			processor: s.circuit.processor,
			id: s.circuit.id.toString(),
			detail: s.detail,
		})),
		gas: f.gas?.map(String) ?? null,
		entries: f.entries.map((e) => ({
			processor: e.processor,
			id: e.id.toString(),
			result: e.result,
		})),
	};
}

export function parsePlanFile(wire: unknown): PlanFile {
	const w = wire as Record<string, unknown>;
	if (w.chainId !== 196 && w.chainId !== 1952) {
		throw new ContractParseError("plan.chainId", "196 or 1952", w.chainId);
	}
	const indexBlock = parseUint(w.indexBlock, "plan.indexBlock");
	if (!Array.isArray(w.entries) || !Array.isArray(w.skipped)) {
		throw new ContractParseError("plan", "entries and skipped lists", w);
	}
	const seen = new Set<string>();
	const entries = w.entries.map((raw: unknown, i: number) => {
		const field = `plan.entries[${i}]`;
		const r = raw as { result?: unknown };
		if (typeof r.result !== "string" || !isHex(r.result)) {
			throw new ContractParseError(`${field}.result`, "hex bytes", r.result);
		}
		let json: unknown;
		try {
			json = JSON.parse(hexToString(r.result as Hex));
		} catch {
			throw new ContractParseError(`${field}.result`, "JSON", r.result);
		}
		const entry = planEntry(parseOriginality(json, `${field}.result`));
		if (entry.result !== r.result) {
			throw new ContractParseError(
				`${field}.result`,
				"the bytes the data contract writes for this result",
				r.result,
			);
		}
		if (entry.indexBlock > indexBlock) {
			throw new ContractParseError(
				`${field}.result`,
				`read at or before the plan's newest block ${indexBlock}`,
				entry.indexBlock,
			);
		}
		if (seen.has(entry.key)) {
			throw new ContractParseError(field, "each circuit once", entry.key);
		}
		seen.add(entry.key);
		return entry;
	});
	return {
		chainId: w.chainId,
		contract:
			w.contract === null ? null : parseAddress(w.contract, "plan.contract"),
		indexBlock,
		unchanged: Number(w.unchanged),
		skipped: w.skipped.map((raw: unknown, i: number) => {
			const s = raw as Record<string, unknown>;
			return {
				circuit: {
					processor: parseAddress(s.processor, `plan.skipped[${i}].processor`),
					id: parseUint(s.id, `plan.skipped[${i}].id`),
				},
				detail: String(s.detail),
			};
		}),
		gas:
			w.gas === null
				? null
				: (w.gas as unknown[]).map((g, i) => parseUint(g, `plan.gas[${i}]`)),
		entries,
	};
}
