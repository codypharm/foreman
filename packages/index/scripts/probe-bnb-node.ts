// Checks a candidate BNB Chain node before Foreman trusts it (docs/decisions/2026-11-21-bnb-nodes.md,
// "Revisit"). The index in Postgres is the truth: it was built from a full archive node. Never prints
// the node's URL, which carries its key.
//
//   BNB_PROBE_RPC_URL in .env, then: pnpm --filter @foreman/index probe-node
//
// 1. Chain id is 56.
// 2. State at old blocks answers, and matches the archive node (BNB_ARCHIVE_RPC_URL) when set.
// 3. The widest TapedOut log read with no address it accepts.
// 4. TapedOut and Sold counts over 50,000-block windows across history match the index exactly.
// 5. How fast a batch of 50 reads comes back, and whether 200 at once are refused.

import pg from "pg";
import {
	createPublicClient,
	encodeFunctionData,
	http,
	keccak256,
	type PublicClient,
	parseAbi,
	toBytes,
} from "viem";
import { bsc } from "viem/chains";

const URL_ = process.env.BNB_PROBE_RPC_URL;
const ARCHIVE = process.env.BNB_ARCHIVE_RPC_URL;
const DATABASE_URL = process.env.DATABASE_URL;
if (!URL_) throw new Error("BNB_PROBE_RPC_URL is not set");
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const BEM = "0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a";
const MARKET = "0x6feebbebc07bcb90bd1ac8b0cf9baa4f0ff2b46f";
const TAPED_OUT = keccak256(toBytes("TapedOut(uint256,address,uint32,uint32)"));
const SOLD = keccak256(
	toBytes("Sold(uint256,address,address,uint256,uint256,uint256)"),
);
const TOTAL_SUPPLY = encodeFunctionData({
	abi: parseAbi(["function totalSupply() view returns (uint256)"]),
	functionName: "totalSupply",
});
const WINDOW = 50_000n;
const WINDOW_STARTS = [
	117_000_000n,
	120_000_000n,
	125_000_000n,
	130_000_000n,
	134_000_000n,
];

/** Error text with any node URL taken out: viem puts the URL in its messages. */
function redact(e: unknown): string {
	let text =
		(e as { shortMessage?: string }).shortMessage ??
		(e as Error).message ??
		String(e);
	for (const u of [URL_, ARCHIVE]) if (u) text = text.split(u).join("<url>");
	return text.replace(/https?:\/\/\S+/g, "<url>").split("\n")[0] ?? "";
}

const client = (url: string, batch = false) =>
	createPublicClient({
		chain: bsc,
		transport: http(url, {
			retryCount: 0,
			timeout: 60_000,
			batch: batch ? { batchSize: 50 } : false,
		}),
	});

const probe = client(URL_);
const archive = ARCHIVE ? client(ARCHIVE) : undefined;
const pool = new pg.Pool({ connectionString: DATABASE_URL });
let failed = 0;
const pass = (line: string) => console.log(`  ok    ${line}`);
const fail = (line: string) => {
	failed++;
	console.log(`  FAIL  ${line}`);
};

const supplyAt = async (c: PublicClient, block: bigint) =>
	BigInt(
		(await c.call({ to: BEM, data: TOTAL_SUPPLY, blockNumber: block })).data ??
			"0x0",
	);

async function logsIn(
	filter: { address?: `0x${string}`; topic: `0x${string}` },
	from: bigint,
	to: bigint,
	chunk: bigint,
) {
	const out: { address: string; blockNumber: bigint | null }[] = [];
	for (let a = from; a <= to; a += chunk) {
		const b = a + chunk - 1n < to ? a + chunk - 1n : to;
		out.push(
			...((await probe.request({
				method: "eth_getLogs",
				params: [
					{
						...(filter.address ? { address: filter.address } : {}),
						topics: [filter.topic],
						fromBlock: `0x${a.toString(16)}`,
						toBlock: `0x${b.toString(16)}`,
					},
				],
			} as never)) as { address: string; blockNumber: bigint | null }[]),
		);
	}
	return out;
}

try {
	console.log("1. chain");
	const chainId = await probe.getChainId();
	chainId === 56 ? pass("chain id 56") : fail(`chain id ${chainId}`);
	const head = await probe.getBlockNumber();
	pass(`head ${head}`);

	console.log("2. state at old blocks");
	for (const block of [117_500_000n, 125_000_000n, head - 20_000n]) {
		try {
			const got = await supplyAt(probe, block);
			if (archive) {
				const want = await supplyAt(archive, block);
				got === want
					? pass(`BEM supply at ${block} matches the archive node`)
					: fail(`BEM supply at ${block}: ${got}, archive node says ${want}`);
			} else pass(`BEM supply at ${block} answered (${got})`);
		} catch (e) {
			fail(`state at ${block}: ${redact(e)}`);
		}
	}

	console.log("3. widest TapedOut log read, no address");
	let chunk = 0n;
	for (const size of [50_000n, 10_000n, 5_000n, 1_000n, 100n]) {
		const from = 125_000_000n;
		const started = Date.now();
		try {
			const logs = await logsIn(
				{ topic: TAPED_OUT },
				from,
				from + size - 1n,
				size,
			);
			pass(
				`${size} blocks in one read: ${logs.length} logs, ${Date.now() - started} ms`,
			);
			chunk = size;
			break;
		} catch (e) {
			console.log(`  no    ${size} blocks: ${redact(e)}`);
		}
	}
	if (!chunk) fail("no log read with no address worked");

	console.log(`4. counts over ${WINDOW}-block windows against the index`);
	const { rows: procRows } = await pool.query<{ address: string }>(
		"select address from processors",
	);
	const processors = new Set(procRows.map((r) => r.address));
	const marketChunk = chunk || 10_000n;
	for (const from of WINDOW_STARTS) {
		const to = from + WINDOW - 1n;
		try {
			if (chunk) {
				const logs = await logsIn({ topic: TAPED_OUT }, from, to, chunk);
				const kept = logs.filter((l) =>
					processors.has(l.address.toLowerCase()),
				).length;
				const { rows } = await pool.query<{ n: string }>(
					"select count(*) as n from circuits where taped_out_block between $1 and $2",
					[from.toString(), to.toString()],
				);
				const want = Number(rows[0]?.n);
				kept === want
					? pass(`TapedOut ${from}–${to}: ${kept}, same as the index`)
					: fail(`TapedOut ${from}–${to}: ${kept}, the index has ${want}`);
			}
			const sold = await logsIn(
				{ address: MARKET, topic: SOLD },
				from,
				to,
				marketChunk,
			);
			const { rows } = await pool.query<{ n: string }>(
				"select count(*) as n from market_sales where block between $1 and $2",
				[from.toString(), to.toString()],
			);
			const want = Number(rows[0]?.n);
			sold.length === want
				? pass(`Sold ${from}–${to}: ${sold.length}, same as the index`)
				: fail(`Sold ${from}–${to}: ${sold.length}, the index has ${want}`);
		} catch (e) {
			fail(`window ${from}: ${redact(e)}`);
		}
	}

	console.log("5. speed");
	const batched = client(URL_, true);
	const calls = (n: number) =>
		Array.from({ length: n }, () =>
			batched.call({ to: BEM, data: TOTAL_SUPPLY, blockNumber: head - 100n }),
		);
	let started = Date.now();
	try {
		await Promise.all(calls(50));
		pass(`50 reads in one batch: ${Date.now() - started} ms`);
	} catch (e) {
		fail(`50 reads in one batch: ${redact(e)}`);
	}
	started = Date.now();
	const results = await Promise.allSettled(calls(200));
	const refused = results.filter((r) => r.status === "rejected");
	refused.length === 0
		? pass(`200 reads at once: ${Date.now() - started} ms, none refused`)
		: fail(
				`200 reads at once: ${refused.length} refused (${redact((refused[0] as PromiseRejectedResult).reason)})`,
			);

	console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
} finally {
	await pool.end();
}
