// One circuit's complete Originality from the stored index, with its can-mine facts read from the
// mining contract at the index's block, so every part of the result says the same block. A result
// is whole or not at all (docs/decisions/2026-11-20-complete-result-or-none.md): a circuit outside
// the index, a netlist not read yet or a failed chain read is an error for the caller, never a
// result, and is never published.

import type { Originality } from "@foreman/contract";
import {
	loadCircuitIndex,
	readCircuitRef,
	readMiners,
	readStoredNetlist,
} from "@foreman/index";
import {
	buildOriginality,
	type CircuitId,
	type CircuitIndex,
	checkWrapper,
	decodeNetlist,
	type MinerRevoke,
	originalityVerdict,
	readCanMine,
	type WrapperCheck,
} from "@foreman/originality";
import type pg from "pg";
import type { PublicClient } from "viem";

export interface ResultContext {
	pool: pg.Pool;
	/** BNB Chain, able to read the index's block (the archive node). */
	client: PublicClient;
	index: CircuitIndex;
	/** Each revoked miner's Revoked event, by circuit. */
	revokes: Map<string, Omit<MinerRevoke, "key">>;
}

export type ResultRead =
	| { ok: true; originality: Originality }
	/** "Can't check" for the caller: never a result, never published. */
	| { ok: false; detail: string };

/** The index and its revokes, loaded once for many results. */
export async function loadResultContext(
	pool: pg.Pool,
	client: PublicClient,
): Promise<
	{ ready: true; context: ResultContext } | { ready: false; detail: string }
> {
	const loaded = await loadCircuitIndex(pool);
	if (!loaded.ready) return { ready: false, detail: loaded.detail };
	const miners = await readMiners(pool);
	const revokes = new Map<string, Omit<MinerRevoke, "key">>();
	for (const m of miners.miners) {
		if (m.revoked) revokes.set(name(m.circuit), m.revoked);
	}
	return {
		ready: true,
		context: { pool, client, index: loaded.index, revokes },
	};
}

export async function buildResult(
	ctx: ResultContext,
	circuit: CircuitId,
	scope: Originality["scope"],
): Promise<ResultRead> {
	const at = { blockNumber: ctx.index.upToBlock };
	const ref = await readCircuitRef(ctx.pool, circuit);
	if (!ref)
		return { ok: false, detail: `${name(circuit)} is outside the index` };

	const stored = await readStoredNetlist(ctx.pool, circuit);
	if (!stored || stored.status === "not-read") {
		return { ok: false, detail: `${name(circuit)}: netlist not read yet` };
	}
	let wrapper: WrapperCheck;
	let usesRef = false;
	if (stored.status === "unreadable") {
		wrapper = {
			kind: "cant-check",
			reason: "netlist-unreadable",
			detail: stored.detail,
		};
	} else {
		const decoded = decodeNetlist(stored.bytes);
		if ("unreadable" in decoded) {
			// Stored as readable, so the bytes decoded once: a mismatch here is a bug, not a verdict
			return {
				ok: false,
				detail: `${name(circuit)}: stored netlist no longer decodes (${decoded.unreadable})`,
			};
		}
		usesRef = decoded.records.some((r) => r.op === "ref");
		wrapper = await checkWrapper(
			ctx.client,
			{
				processor: circuit.processor,
				id: circuit.id,
				nIn: stored.nIn,
				nOut: stored.nOut,
				nState: stored.nState,
				gateCount: stored.gateCount,
				bytes: stored.bytes,
				records: decoded.records,
			},
			at,
		);
	}
	if (wrapper.kind === "cant-check" && wrapper.reason === "read-failed") {
		return { ok: false, detail: `${name(circuit)}: ${wrapper.detail}` };
	}

	const verdict = originalityVerdict({
		target: circuit,
		index: ctx.index,
		wrapper,
	});
	const mining = await readCanMine(
		ctx.client,
		{ circuit, usesRef, revoke: ctx.revokes.get(name(circuit)) ?? null },
		at,
	);
	if (!mining.read) return { ok: false, detail: mining.detail };

	return {
		ok: true,
		originality: buildOriginality({
			circuit: ref,
			scope,
			verdict,
			mining: mining.facts,
			miningContract: mining.mining,
		}),
	};
}

const name = (c: CircuitId) => `${c.processor.toLowerCase()}/${c.id}`;
