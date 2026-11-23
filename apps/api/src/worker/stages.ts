// The worker's three stages, each the same function its command runs (docs/decisions/2026-11-23-hosting.md,
// decisions 2 and 4): the follow (`pnpm --filter @foreman/index follow`), the results job
// (`refresh-results`) and the publish job's plan and send (`publish-results`), here kept in memory
// rather than written to a plan file. Publishing is on the X Layer testnet only: mainnet from the host
// needs a new decision, so it isn't reachable from here.

import { bnbClient } from "@foreman/chain-bnb";
import { followIndex, readPublished } from "@foreman/index";
import type pg from "pg";
import {
	createPublicClient,
	createWalletClient,
	defineChain,
	type Hex,
	http,
	type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { storedResultsToPublish } from "../publish/collect.ts";
import {
	DEFAULT_BATCH_SIZE,
	RESULTS_CONTRACTS,
	XLAYER_RPC,
} from "../publish/contracts.ts";
import { planPublish } from "../publish/plan.ts";
import { recoverBatch } from "../publish/recover.ts";
import { sendPlan } from "../publish/send.ts";
import { refreshResults } from "../results/refresh.ts";
import type { Stage, StageName } from "./cycle.ts";

/** The worker publishes here and nowhere else (hosting ADR, decision 4). */
const PUBLISH_CHAIN = 1952 as const;

export interface WorkerEnv {
	BNB_ARCHIVE_RPC_URL: string;
	BNB_RECENT_RPC_URL?: string | undefined;
	BNB_ARCHIVE_LOG_BLOCKS?: string | undefined;
	XLAYER_RPC_URL?: string | undefined;
	/** The publisher's key, from a sealed host variable. Absent: the publish stage is skipped. Never logged. */
	PUBLISHER_KEY?: string | undefined;
}

export function workerStages(
	pool: pg.Pool,
	env: WorkerEnv,
	log: (line: string) => void = console.log,
): Record<StageName, Stage> {
	const bnb = (options: { batch?: boolean; multicall?: boolean }) =>
		bnbClient({
			archive: env.BNB_ARCHIVE_RPC_URL,
			recent: env.BNB_RECENT_RPC_URL,
			archiveLogBlocks: env.BNB_ARCHIVE_LOG_BLOCKS,
			...options,
		});
	return {
		follow: async () => {
			const client = bnb({ batch: true });
			const { number: toBlock } = await client.getBlock({
				blockTag: "finalized",
			});
			const r = await followIndex(pool, client, {
				toBlock,
				// A long catch-up is otherwise silent for its whole length
				onProgress: (s) => log(`  follow: ${s}`),
				// A long catch-up leaves toBlock too old for publicnode: the market reads on to the head first
				marketCatchUpTo: async () =>
					(await client.getBlock({ blockTag: "finalized" })).number,
			});
			if (!r.followed) {
				return { status: "failed", detail: `${r.stage}: ${r.detail}` };
			}
			// The parts below stop on their own and leave the rest followed; the next run tries them again
			const warnings: string[] = [];
			if (r.commitments.failed.length)
				warnings.push(`${r.commitments.failed.length} commitment reads failed`);
			if (r.netlists.failed.length)
				warnings.push(`${r.netlists.failed.length} netlist reads failed`);
			if (!r.network.followed)
				warnings.push(`network days not followed: ${r.network.detail}`);
			if (!r.owners.followed)
				warnings.push(`owners not followed: ${r.owners.detail}`);
			if (!r.market.followed)
				warnings.push(`market not followed: ${r.market.detail}`);
			return {
				status: "done",
				summary: `to BNB block ${r.toBlock}: ${r.tapeOuts} tape-outs, ${r.starts} miner starts, ${r.revokes} revokes${r.market.followed ? `; market to ${r.market.toBlock}, ${r.market.listings} listings touched, ${r.market.sales} sales` : ""}`,
				warnings,
			};
		},

		refresh: async () => {
			const run = await refreshResults(pool, bnb({ multicall: true }), {
				mode: "auto",
				now: BigInt(Math.floor(Date.now() / 1000)),
			});
			if (!run.refreshed) return { status: "failed", detail: run.detail };
			return {
				status: "done",
				summary: `${run.mode} rebuild at BNB block ${run.indexBlock}: ${run.built} built, ${run.removed} removed`,
				warnings: run.skipped.length
					? [
							`${run.skipped.length} skipped, so the results block doesn't move; first: ${run.skipped[0]?.circuit.processor}/${run.skipped[0]?.circuit.id}: ${run.skipped[0]?.detail}`,
						]
					: [],
			};
		},

		publish: async () => {
			const key = env.PUBLISHER_KEY;
			if (!key) {
				return {
					status: "skipped",
					summary: "no PUBLISHER_KEY set, so nothing is sent",
				};
			}
			if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
				return {
					status: "failed",
					detail: "PUBLISHER_KEY isn't a 32-byte hex key",
				};
			}
			const address = RESULTS_CONTRACTS[PUBLISH_CHAIN];
			if (!address) {
				return {
					status: "failed",
					detail: `no results contract on chain ${PUBLISH_CHAIN}`,
				};
			}
			const contract = { chainId: PUBLISH_CHAIN, address };

			const { results, skipped } = await storedResultsToPublish(pool);
			if (results.length === 0) {
				return {
					status: "failed",
					detail: "no stored results to publish: the results job hasn't run",
				};
			}
			const plan = planPublish(results, await readPublished(pool, contract));
			if (plan.entries.length === 0) {
				return {
					status: "done",
					summary: `nothing changed: ${plan.unchanged} published results still current`,
				};
			}

			const rpc = env.XLAYER_RPC_URL ?? XLAYER_RPC[PUBLISH_CHAIN];
			const chain = defineChain({
				id: PUBLISH_CHAIN,
				name: "X Layer testnet",
				nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
				rpcUrls: { default: { http: [XLAYER_RPC[PUBLISH_CHAIN]] } },
			});
			const publicClient = createPublicClient({
				chain,
				// X Layer's public RPCs refuse more than 10 calls in one batch (measured 21 Nov 2026)
				transport: http(rpc, { retryCount: 3, batch: { batchSize: 10 } }),
			}) as PublicClient;
			const wallet = createWalletClient({
				account: privateKeyToAccount(key as Hex),
				chain,
				transport: http(rpc, { retryCount: 3 }),
			});

			const report = await sendPlan({
				pool,
				publicClient,
				wallet,
				contract,
				plan,
				batchSize: DEFAULT_BATCH_SIZE,
				onBatch: (b, i, of) =>
					log(
						`  publish batch ${i + 1} / ${of}: ${b.entries} results, tx ${b.tx}, block ${b.block}`,
					),
			});
			switch (report.status) {
				case "done":
					return {
						status: "done",
						summary: `${plan.entries.length} results in ${report.sent.length} transactions on X Layer testnet; ${plan.unchanged} unchanged; ${report.alreadyPublished} already published`,
						warnings: skipped.length
							? [`${skipped.length} circuits without a stored result yet`]
							: [],
					};
				case "refused":
					return { status: "failed", detail: `refused: ${report.detail}` };
				case "mismatch":
					return {
						status: "failed",
						detail: `${report.mismatches.length} circuit(s) differ between the chain and the published-results table, so nothing was sent; first: ${report.mismatches[0]?.processor}/${report.mismatches[0]?.id}`,
					};
				case "failed": {
					if (!report.pendingTx) {
						return {
							status: "failed",
							detail: `batch ${report.failedBatch + 1}: ${report.detail}; ${report.sent.length} batch(es) before it recorded`,
						};
					}
					// Sent but not confirmed in time: record it from its receipt now, while this run still
					// holds the plan. If it hasn't landed, the next run's check finds the difference and stops.
					const recovered = await recoverBatch({
						pool,
						publicClient,
						contract,
						plan,
						tx: report.pendingTx,
					});
					return {
						status: "failed",
						detail: recovered.recovered
							? `batch ${report.failedBatch + 1} confirmed late and was recorded (${recovered.tx}, block ${recovered.block}); the next run carries on`
							: `batch ${report.failedBatch + 1} sent as ${report.pendingTx} but not confirmed: ${recovered.detail}`,
					};
				}
			}
		},
	};
}
