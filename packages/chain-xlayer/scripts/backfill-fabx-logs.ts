// FabX's history on X Layer, read once (docs/decisions/2026-11-25-fabx-copy-check.md, "X Layer
// reads"): every log from FabX's processor and FabX's mining contract since the processor was
// created, saved piece by piece to data/fabx-logs-<to>.jsonl so a stopped run resumes. Read only.
//
//   pnpm --filter @foreman/chain-xlayer backfill:fabx-logs [--to <block>]
//
// Then it checks the result: the processor's TapedOut events match its nextId() at the last block,
// and a known tape-out (#24 at block 73,044,971) is there, so an empty answer from a node without
// history can't pass for "no events".

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createPublicClient, http, keccak256, toHex } from "viem";
import { readLogs, type XLayerLog } from "../src/read-logs.ts";

/** CLAUDE.md, "On-chain facts", 25 Nov 2026. */
const FABX_PROCESSOR = "0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6" as const;
const FABX_MINING = "0x4f6a2312d80753bdafd35ddb1bf4bb14c43f8265" as const;
/** The processor's creation block; the mining contract came later, at 73,100,842. */
const FROM = 73_042_958n;
const PUBLIC_NODES = [
	"https://rpc.xlayer.tech",
	"https://xlayerrpc.okx.com",
	"https://xlayer.drpc.org",
];

const topic = (signature: string) => keccak256(toHex(signature));
const NAMES: Record<string, string> = {
	[topic("TapedOut(uint256,address,uint32,uint32)")]: "TapedOut",
	[topic("Transfer(address,address,uint256)")]: "Transfer",
	[topic("DesignCommitted(bytes32,address,address,uint256,uint64)")]:
		"DesignCommitted",
	[topic("ProcessorSet(address,uint256)")]: "ProcessorSet",
	[topic("Upgraded(address)")]: "Upgraded",
	[topic("OwnershipTransferred(address,address)")]: "OwnershipTransferred",
	[topic("Paused(address)")]: "Paused",
	[topic("Unpaused(address)")]: "Unpaused",
	[topic("BoostSet(address)")]: "BoostSet",
};
const TAPED_OUT = topic("TapedOut(uint256,address,uint32,uint32)");

const urls = [
	...(process.env.XLAYER_MAINNET_RPC_URL
		? [process.env.XLAYER_MAINNET_RPC_URL]
		: []),
	...PUBLIC_NODES,
];
const nodes = urls.map((url) =>
	createPublicClient({
		transport: http(url, { retryCount: 0, timeout: 20_000 }),
	}),
);

const toArg = process.argv.indexOf("--to");
const to =
	toArg > 0
		? BigInt(process.argv[toArg + 1] ?? "")
		: await nodes[0]!.getBlockNumber();
mkdirSync("../../data", { recursive: true });
const file = `../../data/fabx-logs-${to}.jsonl`;

const done = new Set<string>();
if (existsSync(file))
	for (const line of readFileSync(file, "utf8").split("\n"))
		if (line) done.add(JSON.parse(line).fromBlock);
const total = Number((to - FROM) / 100n) + 1;
console.log(
	`FabX logs, X Layer blocks ${FROM} to ${to}: ${total} pieces, ${done.size} already saved, ${urls.length} nodes`,
);

let saved = done.size;
const started = Date.now();
const read = await readLogs(
	nodes,
	{ addresses: [FABX_PROCESSOR, FABX_MINING], fromBlock: FROM, toBlock: to },
	{
		skip: (from) => done.has(from.toString()),
		onPiece: ({ fromBlock, toBlock, logs }) => {
			appendFileSync(
				file,
				`${JSON.stringify({ fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), logs }, big)}\n`,
			);
			if (++saved % 1000 === 0) {
				const rate = (saved - done.size) / ((Date.now() - started) / 1000);
				console.log(`${saved} of ${total} pieces, ${rate.toFixed(1)} a second`);
			}
		},
	},
);
if (!read.complete) {
	console.error(
		`Stopped: ${read.detail}. Run again with --to ${to} to resume.`,
	);
	process.exit(1);
}

// Every saved piece, this run's and earlier runs'
const logs: XLayerLog[] = [];
const pieces = new Set<string>();
for (const line of readFileSync(file, "utf8").split("\n")) {
	if (!line) continue;
	const p = JSON.parse(line);
	if (pieces.has(p.fromBlock)) continue;
	pieces.add(p.fromBlock);
	logs.push(...p.logs);
}
if (pieces.size !== total) {
	console.error(`${pieces.size} pieces saved, ${total} expected`);
	process.exit(1);
}

const counts: Record<string, number> = {};
for (const l of logs) {
	const k = `${l.address === FABX_PROCESSOR ? "processor" : "mining"} ${NAMES[l.topics[0] ?? ""] ?? l.topics[0]}`;
	counts[k] = (counts[k] ?? 0) + 1;
}
console.log("logs by contract and event:", counts);

const tapeOuts = logs.filter(
	(l) => l.address === FABX_PROCESSOR && l.topics[0] === TAPED_OUT,
);
const issued = (await nodes[0]!.readContract({
	address: FABX_PROCESSOR,
	abi: [
		{
			name: "nextId",
			type: "function",
			stateMutability: "view",
			inputs: [],
			outputs: [{ type: "uint256" }],
		},
	],
	functionName: "nextId",
	blockNumber: to,
})) as bigint;
const known = tapeOuts.find((l) => BigInt(l.topics[1] ?? "0x0") === 24n);
console.log(
	`TapedOut events: ${tapeOuts.length}; nextId() at block ${to}: ${issued}`,
);
console.log(
	`Known tape-out #24: ${known ? `found at block ${known.blockNumber}` : "MISSING"}`,
);
if (
	BigInt(tapeOuts.length) !== issued ||
	!known ||
	BigInt(known.blockNumber) !== 73_044_971n
) {
	console.error("The check failed: don't use this read.");
	process.exit(1);
}
console.log(`Complete and checked: ${file}`);

function big(_key: string, value: unknown) {
	return typeof value === "bigint" ? value.toString() : value;
}
