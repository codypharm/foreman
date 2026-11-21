import { replayClient } from "@foreman/chain-bnb/fixture";
import {
	type Originality,
	parseHex32,
	parseOriginality,
} from "@foreman/contract";
import { type ResultsContract, readPublished } from "@foreman/index";
import {
	fixtureIndexedDatabase,
	TEST_DATABASE_URL,
} from "@foreman/index/testing";
import circuits from "@foreman/originality/fixtures/bnb-circuits-134673279.json" with {
	type: "json",
};
import type pg from "pg";
import {
	createWalletClient,
	custom,
	hexToString,
	keccak256,
	RpcRequestError,
	zeroAddress,
} from "viem";
import { afterEach, describe, expect, test } from "vitest";
import { buildResult, loadResultContext } from "../result.ts";
import { foremanResultsAbi } from "./abi.ts";
import { FOUNDRY, type LocalXLayer, localXLayer } from "./local-xlayer.ts";
import { planPublish, shortVerdict } from "./plan.ts";
import { recoverBatch } from "./recover.ts";
import { sendPlan } from "./send.ts";

// Sending a plan to ForemanResults on a local X Layer testnet (anvil, chain 1952), with real results
// from the fixture's indexed circuits (docs/decisions/2026-11-21-publish-job.md). The "Published
// result" test from CLAUDE.md: what is written decodes back from the log to the same verdict,
// evidence, rule version and block, and the stored short verdict agrees.

const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c";
const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9";
const CIRCUITS = [
	{ processor: MINE6, id: 2510n, scope: "miner" }, // copy, earlier by commitment
	{ processor: MINE6, id: 153n, scope: "miner" }, // no earlier copy found
	{ processor: P0, id: 6534n, scope: "listed" }, // wrapper
	{ processor: P0, id: 406n, scope: "listed" }, // too small to tell
	{ processor: MINE6, id: 128n, scope: "miner" }, // stopped
] as const;

describe.skipIf(!TEST_DATABASE_URL || !FOUNDRY)("sending a plan", () => {
	let pool: pg.Pool | undefined;
	let chain: LocalXLayer | undefined;
	afterEach(async () => {
		await pool?.end();
		await chain?.stop();
	});

	async function setUp() {
		pool = await fixtureIndexedDatabase();
		chain = await localXLayer();
		const loaded = await loadResultContext(pool, replayClient(circuits));
		if (!loaded.ready) throw new Error(loaded.detail);
		const results: Originality[] = [];
		for (const c of CIRCUITS) {
			const read = await buildResult(loaded.context, c, c.scope);
			if (!read.ok) throw new Error(read.detail);
			results.push(read.originality);
		}
		const contract: ResultsContract = {
			chainId: 1952,
			address: chain.contract,
		};
		return { pool, chain, results, contract };
	}

	test("a published result decodes back from the log unchanged, and its short verdict agrees", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, await readPublished(pool, contract));

		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract,
			plan,
			batchSize: 2,
		});
		expect(report).toMatchObject({ status: "done" });
		expect(report.sent.map((b) => b.entries)).toEqual([2, 2, 1]);

		const logs = await chain.publicClient.getContractEvents({
			address: contract.address,
			abi: foremanResultsAbi,
			eventName: "Published",
			fromBlock: 0n,
		});
		expect(logs).toHaveLength(results.length);
		const recorded = await readPublished(pool, contract);
		for (const o of results) {
			const log = logs.find(
				(l) =>
					l.args.processor?.toLowerCase() === o.circuit.processor &&
					l.args.circuitId === o.circuit.tokenId,
			);
			if (!log?.args.result) throw new Error("no log for a sent result");
			const decoded = parseOriginality(
				JSON.parse(hexToString(log.args.result)),
				"logged",
			);
			expect(decoded).toEqual(o);
			expect(decoded.result).toEqual(o.result);
			expect(decoded.ruleVersion).toBe(o.ruleVersion);
			expect(decoded.index.upToBlock.block).toBe(134_673_279n);

			const stored = await chain.publicClient.readContract({
				address: contract.address,
				abi: foremanResultsAbi,
				functionName: "resultOf",
				args: [o.circuit.processor, o.circuit.tokenId],
			});
			expect(stored).toEqual({
				...shortVerdict(o),
				indexBlock: o.index.upToBlock.block,
				resultHash: keccak256(log.args.result),
			});
			const row = recorded.get(parseHex32(log.args.key, "key"));
			expect(row).toMatchObject({
				resultHash: stored.resultHash,
				tx: log.transactionHash,
				block: log.blockNumber,
			});
		}
	});

	test("after a publish, the same results plan nothing", async () => {
		const { pool, chain, results, contract } = await setUp();
		const first = planPublish(results, await readPublished(pool, contract));
		await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract,
			plan: first,
			batchSize: 10,
		});
		const again = planPublish(results, await readPublished(pool, contract));
		expect(again.entries).toEqual([]);
		expect(again.unchanged).toBe(results.length);
	});

	test("a result on chain that the table doesn't know stops the run before anything is sent", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, await readPublished(pool, contract));
		// Published straight to the contract, as if a batch landed and was never recorded
		const landed = plan.entries[1];
		if (!landed) throw new Error("no entry");
		const hash = await chain.publisher.writeContract({
			address: contract.address,
			abi: foremanResultsAbi,
			functionName: "publish",
			args: [
				[
					{
						processor: landed.processor,
						circuitId: landed.id,
						kind: landed.kind,
						canMine: landed.canMine,
						indexBlock: landed.indexBlock,
						result: landed.result,
					},
				],
			],
			account: chain.publisher.account ?? null,
			chain: chain.publisher.chain,
		});
		await chain.publicClient.waitForTransactionReceipt({ hash });
		const before = await chain.publicClient.getBlockNumber();

		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract,
			plan,
			batchSize: 10,
		});
		expect(report).toMatchObject({
			status: "mismatch",
			mismatches: [
				{
					processor: landed.processor,
					id: landed.id,
					onChain: landed.resultHash,
					recorded: `0x${"0".repeat(64)}`,
				},
			],
		});
		expect(await chain.publicClient.getBlockNumber()).toBe(before);
		expect((await readPublished(pool, contract)).size).toBe(0);
	});

	test("a failed batch stops the run: earlier batches recorded, it and later ones not", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, await readPublished(pool, contract));
		// The contract refuses a zero processor (BadEntry), which the table would accept: the second
		// batch of two is mined and reverts
		const entries = plan.entries.map((e, i) =>
			i === 2 ? { ...e, processor: zeroAddress as typeof e.processor } : e,
		);

		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract,
			plan: { ...plan, entries },
			batchSize: 2,
		});
		expect(report).toMatchObject({ status: "failed", failedBatch: 1 });
		expect(report.sent).toHaveLength(1);
		const recorded = await readPublished(pool, contract);
		expect([...recorded.values()].map((r) => r.id).sort()).toEqual(
			entries
				.slice(0, 2)
				.map((e) => e.id)
				.sort(),
		);
		const logs = await chain.publicClient.getContractEvents({
			address: contract.address,
			abi: foremanResultsAbi,
			eventName: "Published",
			fromBlock: 0n,
		});
		expect(logs).toHaveLength(2);
	});

	test("an RPC failure mid-run stops it: earlier batches recorded, the rest not sent", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, await readPublished(pool, contract));
		const node = chain;
		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract,
			plan,
			batchSize: 2,
			// The node goes away after the first batch is recorded
			onBatch: async (_b, i) => {
				if (i === 0) await node.stop();
			},
		});
		expect(report).toMatchObject({ status: "failed", failedBatch: 1 });
		expect(report.sent).toHaveLength(1);
		expect((await readPublished(pool, contract)).size).toBe(2);
	});

	test("a node that can't be read before sending is a clean refusal, with nothing sent", async () => {
		const { pool, chain, results, contract } = await setUp();
		await chain.stop();
		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract,
			plan: planPublish(results, new Map()),
			batchSize: 10,
		});
		expect(report).toMatchObject({
			status: "refused",
			detail: expect.stringContaining("nothing was sent"),
		});
		expect((await readPublished(pool, contract)).size).toBe(0);
	});

	test("a batch that landed unrecorded is recovered from its receipt, and the same plan then resumes without resending it", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, await readPublished(pool, contract));
		// Sent straight to the contract, as if the wait for its receipt had timed out
		const landed = plan.entries.slice(0, 2);
		const tx = await chain.publisher.writeContract({
			address: contract.address,
			abi: foremanResultsAbi,
			functionName: "publish",
			args: [
				landed.map((e) => ({
					processor: e.processor,
					circuitId: e.id,
					kind: e.kind,
					canMine: e.canMine,
					indexBlock: e.indexBlock,
					result: e.result,
				})),
			],
			account: chain.publisher.account ?? null,
			chain: chain.publisher.chain,
		});
		await chain.publicClient.waitForTransactionReceipt({ hash: tx });

		const recovered = await recoverBatch({
			pool,
			publicClient: chain.publicClient,
			contract,
			plan,
			tx: parseHex32(tx, "tx"),
		});
		expect(recovered).toMatchObject({ recovered: true, entries: 2 });
		const recorded = await readPublished(pool, contract);
		expect([...recorded.values()].map((r) => r.tx)).toEqual([tx, tx]);

		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract,
			plan,
			batchSize: 10,
		});
		expect(report).toMatchObject({ status: "done", alreadyPublished: 2 });
		expect(report.sent.map((b) => b.entries)).toEqual([3]);
		const logs = await chain.publicClient.getContractEvents({
			address: contract.address,
			abi: foremanResultsAbi,
			eventName: "Published",
			fromBlock: 0n,
		});
		expect(logs).toHaveLength(results.length);
	});

	test("a node that takes a batch but times out answering still names the transaction, which can then be recovered", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, await readPublished(pool, contract));
		// As on the testnet at batch 125 (21 Nov 2026): the node accepted the transaction and the
		// request timed out before it returned the hash
		const node = chain.publisher;
		const timesOut = createWalletClient({
			account: node.account,
			chain: node.chain,
			transport: custom(
				{
					async request({ method, params }) {
						const answer = await node.request({ method, params } as never);
						if (method.startsWith("eth_send")) {
							throw new Error("The request took too long to respond.");
						}
						return answer;
					},
				},
				{ retryCount: 0 },
			),
		});
		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: timesOut,
			contract,
			plan,
			batchSize: 10,
		});
		expect(report).toMatchObject({ status: "failed", failedBatch: 0 });
		if (report.status !== "failed" || !report.pendingTx) {
			throw new Error("the failed batch named no transaction");
		}
		expect((await readPublished(pool, contract)).size).toBe(0);
		// It lands even though nobody heard back
		await chain.publicClient.waitForTransactionReceipt({
			hash: report.pendingTx,
		});

		const recovered = await recoverBatch({
			pool,
			publicClient: chain.publicClient,
			contract,
			plan,
			tx: report.pendingTx,
		});
		expect(recovered).toMatchObject({
			recovered: true,
			entries: results.length,
		});
	});

	test("a batch the node refuses outright is not left pending: nothing was sent", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, await readPublished(pool, contract));
		// As at batch 41 (21 Nov 2026): the node answered with an error and kept nothing
		const node = chain.publisher;
		const refuses = createWalletClient({
			account: node.account,
			chain: node.chain,
			transport: custom(
				{
					async request({ method, params }) {
						if (method === "eth_sendRawTransaction") {
							throw new RpcRequestError({
								body: { method, params },
								error: { code: -32000, message: "oversized data" },
								url: "local",
							});
						}
						return node.request({ method, params } as never);
					},
				},
				{ retryCount: 0 },
			),
		});
		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: refuses,
			contract,
			plan,
			batchSize: 10,
		});
		expect(report).toMatchObject({
			status: "failed",
			failedBatch: 0,
			detail: expect.stringContaining("oversized data"),
		});
		expect(report).not.toHaveProperty("pendingTx");
		const logs = await chain.publicClient.getContractEvents({
			address: contract.address,
			abi: foremanResultsAbi,
			eventName: "Published",
			fromBlock: 0n,
		});
		expect(logs).toHaveLength(0);
	});

	test("a transaction whose events aren't the plan's is never recovered", async () => {
		const { pool, chain, results, contract } = await setUp();
		const plan = planPublish(results, new Map());
		const first = plan.entries[0];
		if (!first) throw new Error("no entry");
		const tx = await chain.publisher.writeContract({
			address: contract.address,
			abi: foremanResultsAbi,
			functionName: "publish",
			args: [
				[
					{
						processor: first.processor,
						circuitId: first.id,
						kind: first.kind,
						canMine: first.canMine,
						indexBlock: first.indexBlock,
						result: first.result,
					},
				],
			],
			account: chain.publisher.account ?? null,
			chain: chain.publisher.chain,
		});
		await chain.publicClient.waitForTransactionReceipt({ hash: tx });

		const report = await recoverBatch({
			pool,
			publicClient: chain.publicClient,
			contract,
			plan: { entries: plan.entries.slice(1), unchanged: 0 },
			tx: parseHex32(tx, "tx"),
		});
		expect(report).toMatchObject({ recovered: false });
		expect((await readPublished(pool, contract)).size).toBe(0);
	});

	test("a wallet that isn't the publisher is refused before anything is read or sent", async () => {
		const { pool, chain, results, contract } = await setUp();
		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.owner,
			contract,
			plan: planPublish(results, new Map()),
			batchSize: 10,
		});
		expect(report).toMatchObject({ status: "refused" });
		expect((await readPublished(pool, contract)).size).toBe(0);
	});

	test("a contract on another chain is refused", async () => {
		const { pool, chain, results, contract } = await setUp();
		const report = await sendPlan({
			pool,
			publicClient: chain.publicClient,
			wallet: chain.publisher,
			contract: { ...contract, chainId: 196 },
			plan: planPublish(results, new Map()),
			batchSize: 10,
		});
		expect(report).toMatchObject({
			status: "refused",
			detail: "the RPC is on chain 1952, the contract on 196",
		});
	});
});
