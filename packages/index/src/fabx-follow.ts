// Follows FabX on X Layer from the block its history is stored up to (2026-11-26-fabx-follow.md).
// Everything is read first, at one block: the logs, each new circuit's netlist and every miner
// record. Then it is saved in one transaction, or nothing is (decision 5). A freezing event cuts
// the follow at the block before it, and a frozen FabX isn't read at all
// (2026-11-25-fabx-copy-check.md, decision 6). Read only on chain.

import {
	decodeFabxLogs,
	FABX_MINING,
	FABX_PROCESSOR,
	type LogNode,
	readFabxMiners,
	readLogs,
} from "@foreman/chain-xlayer";
import { type NetlistRead, readNetlist } from "@foreman/originality";
import type pg from "pg";
import { type PublicClient, parseAbi } from "viem";
import { saveNetlistRead } from "./backfill.ts";
import {
	FREEZING,
	fillFabxClaimTimes,
	readFabxState,
	saveFabxHistory,
	saveFabxMiners,
} from "./fabx.ts";
import { inTransaction } from "./transaction.ts";

const nextIdAbi = parseAbi(["function nextId() view returns (uint256)"]);

export type FabxFollow =
	| {
			followed: true;
			fromBlock: bigint;
			/** The block FabX is now stored up to: `toBlock`, or the block before a freezing event. */
			toBlock: bigint;
			/** Circuits taped out in the range, by id. */
			newCircuits: bigint[];
			/** The freezing event's block, when this follow found one. */
			frozenAtBlock: bigint | null;
	  }
	/** Frozen before this follow: nothing read, nothing saved. */
	| { followed: "frozen"; frozenAtBlock: bigint; upToBlock: bigint }
	/** FabX's history was never stored: there is nothing to follow from. */
	| { followed: "absent" }
	/** Nothing saved; FabX stays at its block. */
	| { followed: false; detail: string };

export async function followFabx(
	pool: pg.Pool,
	nodes: {
		/** Netlists, miner records and block times, read at past blocks. */
		client: PublicClient;
		/** Log reads, shared between them. */
		logNodes: readonly LogNode[];
	},
	options: { toBlock: bigint },
): Promise<FabxFollow> {
	const state = await readFabxState(pool);
	if (!state) return { followed: "absent" };
	if (state.frozenAtBlock !== null) {
		return {
			followed: "frozen",
			frozenAtBlock: state.frozenAtBlock,
			upToBlock: state.logsUpToBlock,
		};
	}
	const fromBlock = state.logsUpToBlock + 1n;
	try {
		const chainId = await nodes.client.getChainId();
		if (chainId !== 196) {
			return {
				followed: false,
				detail: `the X Layer node answers for chain ${chainId}, not 196`,
			};
		}
		if (options.toBlock < fromBlock) {
			return {
				followed: true,
				fromBlock,
				toBlock: state.logsUpToBlock,
				newCircuits: [],
				frozenAtBlock: null,
			};
		}

		const logs = await readLogs(nodes.logNodes, {
			addresses: [FABX_PROCESSOR, FABX_MINING],
			fromBlock,
			toBlock: options.toBlock,
		});
		if (!logs.complete) return { followed: false, detail: logs.detail };
		const history = decodeFabxLogs(logs.logs);
		if (!history.ok) return { followed: false, detail: history.detail };

		// The first freezing event: FabX is saved only up to the block before it
		const freeze = history.contractEvents
			.filter(
				(e) => FREEZING.includes(e.kind) && e.at.block > state.reviewed.atBlock,
			)
			.sort((a, b) => (a.at.block < b.at.block ? -1 : 1))[0];
		const upTo = freeze ? freeze.at.block - 1n : options.toBlock;
		const before = <T extends { at: { block: bigint } }>(items: T[]) =>
			items.filter((i) => i.at.block <= upTo);
		const kept = {
			...history,
			tapeOuts: before(history.tapeOuts),
			commitments: before(history.commitments),
			starts: before(history.starts),
			// The freezing event itself is kept: it records the freeze
			contractEvents: history.contractEvents.filter(
				(e) => e.at.block <= upTo || e === freeze,
			),
		};

		const newCircuits = kept.tapeOuts.map((t) => ({
			processor: t.processor,
			id: t.id,
		}));
		const stored = (
			await pool.query<{ id: string; unread: boolean }>(
				"select id, netlist_status is null as unread from xlayer_circuits",
			)
		).rows;
		const storedIds = stored.map((r) => BigInt(r.id));
		// A node can answer a log read with nothing: the processor's own count must agree. nextId()
		// returns the last id issued, not the next (CLAUDE.md, "Tape-out scan")
		const issued = await nodes.client.readContract({
			address: FABX_PROCESSOR,
			abi: nextIdAbi,
			functionName: "nextId",
			blockNumber: upTo,
		});
		const highest = [...storedIds, ...newCircuits.map((c) => c.id)].reduce(
			(a, b) => (b > a ? b : a),
			0n,
		);
		const highestStored = storedIds.reduce((a, b) => (b > a ? b : a), 0n);
		const consecutive = newCircuits.every(
			(c, i) => c.id === highestStored + BigInt(i) + 1n,
		);
		if (issued !== highest || !consecutive) {
			return {
				followed: false,
				detail: `FabX's processor had issued up to #${issued} at block ${upTo}; the logs give tape-outs up to #${highest}`,
			};
		}
		// Every netlist not stored yet, new or not, read at the one block
		const unread = [
			...stored.filter((r) => r.unread).map((r) => BigInt(r.id)),
			...newCircuits.map((c) => c.id),
		];
		const netlists: { id: bigint; read: NetlistRead }[] = [];
		for (const id of unread) {
			const read = await readNetlist(
				nodes.client,
				{ processor: FABX_PROCESSOR, id },
				{ blockNumber: upTo },
			);
			if (!read.readable && read.reason === "read-failed") {
				return { followed: false, detail: `FabX #${id}: ${read.detail}` };
			}
			netlists.push({ id, read });
		}
		const ids = [...new Set([...storedIds, ...newCircuits.map((c) => c.id)])];
		ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		const miners =
			upTo > state.logsUpToBlock
				? await readFabxMiners(nodes.client, { ids, blockNumber: upTo })
				: null;
		if (miners && !miners.complete) {
			return { followed: false, detail: miners.detail };
		}

		await inTransaction(pool, async (tx) => {
			await saveFabxHistory(
				tx,
				{ fromBlock, toBlock: upTo, history: kept },
				state.reviewed,
			);
			for (const n of netlists) {
				await saveNetlistRead(
					tx,
					"xlayer_circuits",
					{ processor: FABX_PROCESSOR, id: n.id },
					upTo,
					n.read,
				);
			}
			if (miners) await saveFabxMiners(tx, miners);
			// A few block reads, inside the transaction so a failed one saves nothing
			await fillFabxClaimTimes(tx, nodes.client);
		});
		return {
			followed: true,
			fromBlock,
			toBlock: upTo > state.logsUpToBlock ? upTo : state.logsUpToBlock,
			newCircuits: newCircuits.map((c) => c.id),
			frozenAtBlock: freeze?.at.block ?? null,
		};
	} catch (error) {
		// viem's full message names the node's URL, which can carry a key: keep its short message
		const short =
			(error as { shortMessage?: string }).shortMessage ??
			(error as Error).message;
		return { followed: false, detail: `FabX follow: ${short}` };
	}
}
