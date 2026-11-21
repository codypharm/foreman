// The publish job (docs/decisions/2026-11-21-publish-job.md). A command William runs.
//
// Dry run (no key): builds every miner's and listed circuit's result from the index, works out what
// changed since the last publish, and writes the plan to data/. Needs DATABASE_URL and
// BNB_ARCHIVE_RPC_URL.
//
//   pnpm --filter @foreman/api publish-results --chain testnet [--batch 100]
//
// Send: sends exactly that plan file to ForemanResults, after checking the chain against the
// published-results table. Needs DATABASE_URL and PUBLISHER_KEY, the dedicated publisher wallet's
// key, set for this run only. It is never logged or written anywhere.
//
//   pnpm --filter @foreman/api publish-results --chain testnet --send data/publish-plan-1952-<block>.json
//
// A stopped send resumes with the same command: entries already recorded with the same hash are
// skipped. A batch that was sent but not confirmed in time is recorded from its receipt, once it
// has landed, with --recover (no key: it reads the chain and writes the table only):
//
//   pnpm --filter @foreman/api publish-results --chain testnet --send data/publish-plan-1952-<block>.json --recover 0x<tx>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseHex32 } from "@foreman/contract";
import { migrate, readPublished } from "@foreman/index";
import pg from "pg";
import {
	createPublicClient,
	createWalletClient,
	defineChain,
	type Hex,
	http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { foremanResultsAbi } from "../src/publish/abi.ts";
import { batchEntries, MAX_BATCH_CALLDATA } from "../src/publish/batch.ts";
import { circuitsToPublish, collectResults } from "../src/publish/collect.ts";
import {
	DEFAULT_BATCH_SIZE,
	RESULTS_CONTRACTS,
	type ResultsChain,
	XLAYER_RPC,
} from "../src/publish/contracts.ts";
import { planPublish } from "../src/publish/plan.ts";
import {
	type PlanFile,
	parsePlanFile,
	serialisePlanFile,
} from "../src/publish/plan-file.ts";
import { recoverBatch } from "../src/publish/recover.ts";
import { sendPlan } from "../src/publish/send.ts";
import { loadResultContext } from "../src/result.ts";

const { values } = parseArgs({
	options: {
		chain: { type: "string" },
		batch: { type: "string" },
		send: { type: "string" },
		recover: { type: "string" },
	},
});
const chainId: ResultsChain = chainFrom(values.chain);
const batchSize = Number(values.batch ?? DEFAULT_BATCH_SIZE);
if (!Number.isInteger(batchSize) || batchSize < 1) {
	throw new Error("--batch must be a whole number of entries, 1 or more");
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
	throw new Error("DATABASE_URL is not set (see .env.example)");

const contractAddress = RESULTS_CONTRACTS[chainId];
const xlayer = defineChain({
	id: chainId,
	name: chainId === 196 ? "X Layer" : "X Layer testnet",
	nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
	rpcUrls: { default: { http: [XLAYER_RPC[chainId]] } },
});
const xlayerRpc = process.env.XLAYER_RPC_URL ?? XLAYER_RPC[chainId];
const xlayerClient = createPublicClient({
	chain: xlayer,
	// X Layer's public RPCs refuse more than 10 calls in one batch (measured 21 Nov 2026)
	transport: http(xlayerRpc, { retryCount: 3, batch: { batchSize: 10 } }),
});

const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	await migrate(pool);
	if (values.recover) {
		if (!values.send)
			throw new Error("--recover needs the plan file, as --send");
		await recover(values.send, values.recover);
	} else if (values.send) await send(values.send);
	else await dryRun();
} finally {
	await pool.end();
}

async function dryRun() {
	const rpc = process.env.BNB_ARCHIVE_RPC_URL;
	if (!rpc)
		throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");
	const bnb = createPublicClient({
		chain: bsc,
		transport: http(rpc, {
			retryCount: 5,
			timeout: 30_000,
			batch: { batchSize: 50 },
		}),
	});
	const loaded = await loadResultContext(pool, bnb);
	if (!loaded.ready) {
		console.error(`the index isn't ready: ${loaded.detail}`);
		process.exitCode = 1;
		return;
	}
	const indexBlock = loaded.context.index.upToBlock;
	const targets = await circuitsToPublish(pool);
	console.log(
		`building ${targets.length} results at BNB Chain block ${indexBlock}`,
	);
	const { results, skipped } = await collectResults(loaded.context, targets, {
		concurrency: 50,
		onProgress: (done, of) => {
			if (done % 1_000 < 50 || done === of) console.log(`  ${done} / ${of}`);
		},
	});
	const published = contractAddress
		? await readPublished(pool, { chainId, address: contractAddress })
		: new Map();
	const plan = planPublish(results, published);

	let gas: bigint[] | null = null;
	if (contractAddress && plan.entries.length > 0) {
		const publisher = await xlayerClient.readContract({
			address: contractAddress,
			abi: foremanResultsAbi,
			functionName: "publisher",
		});
		gas = [];
		for (const batch of batchEntries(plan.entries, { maxEntries: batchSize })) {
			gas.push(
				await xlayerClient.estimateContractGas({
					address: contractAddress,
					abi: foremanResultsAbi,
					functionName: "publish",
					args: [
						batch.map((e) => ({
							processor: e.processor,
							circuitId: e.id,
							kind: e.kind,
							canMine: e.canMine,
							indexBlock: e.indexBlock,
							result: e.result,
						})),
					],
					account: publisher,
				}),
			);
		}
	}

	const file: PlanFile = {
		chainId,
		contract: contractAddress,
		indexBlock,
		unchanged: plan.unchanged,
		skipped,
		gas,
		entries: plan.entries,
	};
	const path = new URL(
		`../../../data/publish-plan-${chainId}-${indexBlock}.json`,
		import.meta.url,
	);
	mkdirSync(new URL(".", path), { recursive: true });
	const wire = serialisePlanFile(file) as { byVerdict: unknown };
	writeFileSync(path, `${JSON.stringify(wire, null, "\t")}\n`);

	console.log(`plan written to ${path.pathname}`);
	console.log(
		`  ${plan.entries.length} to publish in ${batchEntries(plan.entries, { maxEntries: batchSize }).length} batches of up to ${batchSize}, each under ${MAX_BATCH_CALLDATA} bytes; ${plan.unchanged} unchanged; ${skipped.length} skipped`,
	);
	console.log(`  by verdict: ${JSON.stringify(wire.byVerdict)}`);
	console.log(
		gas
			? `  estimated gas: ${gas.reduce((a, b) => a + b, 0n)} in all, ${largest(gas)} for the largest batch`
			: contractAddress
				? "  nothing to estimate"
				: `  no results contract on chain ${chainId} yet: compared against an empty record, gas not estimated, --send refused`,
	);
	for (const s of skipped.slice(0, 20)) {
		console.log(
			`  skipped ${s.circuit.processor}/${s.circuit.id}: ${s.detail}`,
		);
	}
	if (skipped.length > 20)
		console.log(`  and ${skipped.length - 20} more skipped`);
}

async function send(planPath: string) {
	if (!contractAddress) {
		throw new Error(
			`no results contract on chain ${chainId} yet: deploy it and list it in On-chain facts first`,
		);
	}
	const file = loadPlan(planPath);
	const key = process.env.PUBLISHER_KEY;
	if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
		throw new Error("PUBLISHER_KEY is not set, or isn't a 32-byte hex key");
	}
	const account = privateKeyToAccount(key as Hex);
	const wallet = createWalletClient({
		account,
		chain: xlayer,
		transport: http(xlayerRpc, { retryCount: 3 }),
	});
	console.log(
		`sending ${file.entries.length} results to ${contractAddress} on chain ${chainId} from ${account.address}`,
	);
	const report = await sendPlan({
		pool,
		publicClient: xlayerClient,
		wallet,
		contract: { chainId, address: contractAddress },
		plan: { entries: file.entries, unchanged: file.unchanged },
		batchSize,
		onBatch: (b, i, of) =>
			console.log(
				`  batch ${i + 1} / ${of}: ${b.entries} results, tx ${b.tx}, block ${b.block}`,
			),
	});
	switch (report.status) {
		case "done":
			console.log(
				`done: ${report.sent.length} batches sent and recorded; ${report.alreadyPublished} already published, skipped`,
			);
			return;
		case "refused":
			console.error(`refused: ${report.detail}`);
			break;
		case "mismatch":
			console.error(
				`stopped before sending: ${report.mismatches.length} circuit(s) differ between the chain and the table`,
			);
			for (const m of report.mismatches.slice(0, 20)) {
				console.error(
					`  ${m.processor}/${m.id}: on chain ${m.onChain}, recorded ${m.recorded}`,
				);
			}
			break;
		case "failed":
			console.error(
				`stopped at batch ${report.failedBatch + 1}: ${report.detail}. ${report.sent.length} batch(es) before it were sent and recorded.`,
			);
			if (report.pendingTx) {
				console.error(
					`That batch was sent as ${report.pendingTx} and may still land. Once it has, record it with:\n  pnpm --filter @foreman/api publish-results --chain ${values.chain} --send ${planPath} --recover ${report.pendingTx}\nthen run this send again to carry on.`,
				);
			} else {
				console.error("Run this send again to carry on.");
			}
			break;
	}
	process.exitCode = 1;
}

function chainFrom(name: string | undefined): ResultsChain {
	if (name === "testnet") return 1952;
	if (name === "mainnet") return 196;
	throw new Error("--chain testnet or --chain mainnet is required");
}

function largest(values: bigint[]): bigint {
	let most = 0n;
	for (const v of values) if (v > most) most = v;
	return most;
}

/** The plan file, checked to be for this chain's contract. */
function loadPlan(planPath: string): PlanFile {
	if (!contractAddress) {
		throw new Error(
			`no results contract on chain ${chainId} yet: deploy it and list it in On-chain facts first`,
		);
	}
	// pnpm runs this from apps/api; a relative path means the folder the command was typed in
	const fullPath = resolve(process.env.INIT_CWD ?? process.cwd(), planPath);
	const file = parsePlanFile(JSON.parse(readFileSync(fullPath, "utf8")));
	if (file.chainId !== chainId || file.contract !== contractAddress) {
		throw new Error(
			`the plan was made for chain ${file.chainId}, contract ${file.contract ?? "none"}; make a new plan for chain ${chainId}, contract ${contractAddress}`,
		);
	}
	return file;
}

async function recover(planPath: string, tx: string) {
	const file = loadPlan(planPath);
	const report = await recoverBatch({
		pool,
		publicClient: xlayerClient,
		contract: {
			chainId,
			address: file.contract as NonNullable<PlanFile["contract"]>,
		},
		plan: { entries: file.entries, unchanged: file.unchanged },
		tx: parseHex32(tx, "--recover"),
	});
	if (report.recovered) {
		console.log(
			`recorded ${report.entries} results from ${report.tx}, block ${report.block}`,
		);
	} else {
		console.error(`not recovered: ${report.detail}`);
		process.exitCode = 1;
	}
}
