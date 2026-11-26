// POST /v1/results's answers (docs/decisions/2026-11-26-api-keys.md, decisions 2 to 4): each circuit's
// stored result and where it was published, or its result built on request as the result page builds
// it ("pasted", never stored or published). A circuit that can't be checked is "not-checked" with its
// reason, never a verdict; one circuit's failure never stops the others.

import { minerKey } from "@foreman/chain-bnb";
import {
	type BulkCircuit,
	type BulkRequest,
	type BulkResult,
	type BulkResults,
	type StoredCheck,
	serialiseStoredCheck,
} from "@foreman/contract";
import { readCircuitRef, readStoredResult } from "@foreman/index";
import { BaseError } from "viem";
import { type PageDeps, publishedState } from "../page/circuit-page.ts";
import { buildResult } from "../result.ts";

/** Circuits answered at once: builds read the archive node, which refuses bursts. */
const AT_ONCE = 8;

export async function readBulkResults(
	deps: PageDeps,
	request: BulkRequest,
): Promise<BulkResults> {
	const results: BulkResult[] = new Array(request.circuits.length);
	let next = 0;
	const worker = async () => {
		while (next < request.circuits.length) {
			const i = next++;
			const circuit = request.circuits[i] as BulkCircuit;
			results[i] = await answer(deps, circuit);
		}
	};
	await Promise.all(Array.from({ length: AT_ONCE }, worker));
	return { results };
}

async function answer(deps: PageDeps, c: BulkCircuit): Promise<BulkResult> {
	const circuit = { processor: c.processor, id: c.tokenId };
	const named = `Circuit #${c.tokenId} on processor ${c.processor}`;
	try {
		const check = await checkOf(deps, c, named);
		// Each answer is checked against the contract on its own, so one circuit can't fail the call
		serialiseStoredCheck(check, "check");
		return {
			circuit: c,
			check,
			published: await publishedState(deps, check, minerKey(circuit)),
		};
	} catch (error) {
		return {
			circuit: c,
			check: { state: "not-checked", detail: `${named}: ${plain(error)}` },
			published: { state: "not-published", reason: "not-yet" },
		};
	}
}

async function checkOf(
	deps: PageDeps,
	c: BulkCircuit,
	named: string,
): Promise<StoredCheck> {
	const circuit = { processor: c.processor, id: c.tokenId };
	const ref = await readCircuitRef(deps.pool, circuit);
	if (!ref) {
		return {
			state: "not-checked",
			detail: `${named} isn't in Foreman's index`,
		};
	}
	if (ref.chainId !== c.chainId) {
		return {
			state: "not-checked",
			detail: `${named} is on chain ${ref.chainId}, not ${c.chainId}`,
		};
	}
	const stored = await readStoredResult(deps.pool, circuit);
	if (stored) return { state: "checked", originality: stored.originality };
	const loaded = await deps.resultContext();
	if (!loaded.ready) return { state: "not-checked", detail: loaded.detail };
	const built = await buildResult(loaded.context, circuit, "pasted");
	if (!built.ok) return { state: "not-checked", detail: built.detail };
	// A miner is checked by the results job, never on request: until its row is stored it's "Can't
	// check", as on its result page (a pasted result can't carry a miner's design bonus)
	if (built.originality.mining !== null) {
		return {
			state: "not-checked",
			detail: "Foreman hasn't checked this miner yet",
		};
	}
	return { state: "checked", originality: built.originality };
}

/** Plain words: viem's short message, never the node's URL or the call's data. */
function plain(error: unknown): string {
	if (error instanceof BaseError) return error.shortMessage;
	return error instanceof Error ? error.message : String(error);
}
