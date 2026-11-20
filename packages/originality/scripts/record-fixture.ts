// Records the JSON-RPC responses the originality tests replay: real circuits chosen to cover
// every verdict and fact in docs/decisions/2026-11-20-copy-and-wrapper-rules.md and
// 2026-11-20-verdict-scope-and-earliest-design.md. The cases are listed in fixtures/README.md.
//
// Read only: eth_call, eth_getLogs and eth_getBlockByNumber. It never sends a transaction and
// needs no key, only the archive endpoint in BNB_ARCHIVE_RPC_URL (.env). Re-run it only to add
// a circuit or move to a new block.
//
//   pnpm --filter @foreman/originality record

import { writeFileSync } from "node:fs";
import { POD_MINING } from "@foreman/chain-bnb";
import { type RpcCall, recordingClient } from "@foreman/chain-bnb/fixture";
import {
	type Address,
	createPublicClient,
	encodePacked,
	type Hex,
	http,
	keccak256,
	numberToHex,
	type PublicClient,
	pad,
	parseAbi,
	toHex,
} from "viem";

const RPC = process.env.BNB_ARCHIVE_RPC_URL;
if (!RPC) throw new Error("BNB_ARCHIVE_RPC_URL is not set (see .env.example)");

/** Every read is pinned here, so the replay gives one answer per call. */
const BLOCK = 134_673_279n;
/** Ref chains are followed this far when recording, past any chain the cases contain. */
const MAX_REF_DEPTH = 5;

const processorAbi = parseAbi([
	"function netlist(uint256 id) view returns (bytes)",
	"function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
	"function nextId() view returns (uint256)",
]);
const miningAbi = parseAbi([
	"function processorMultiplier(address) view returns (uint256)",
	"function getMiner(bytes32 key) view returns ((address circuits, uint64 circuitId, uint32 taskId, uint32 gateCount, uint32 stateCount, uint32 depth, uint64 area, uint32 mult, uint64 since, uint8 status, address registrant, uint32 nandBurn, uint32 latchBurn, uint64 bstar, uint64 bonus, bool optimal, uint64 commitBlock, uint64 firstUnusedId, uint64 stopBlock, uint128 verifWeight, uint128 unverWeight, uint256 debt))",
]);
const TAPED_OUT =
	"0xc11215e417669c143c8a07aeb778034c0a0a85ebdf305d64a629b19a7a9ce031"; // TapedOut(uint256,address,uint32,uint32)
const DESIGN_COMMITTED =
	"0xc11b6e74f2be6ba6b5ab2de256421ba2804957af07488c5cbac090834a11fdfc"; // DesignCommitted(bytes32,address,address,uint256,uint64)
const REVOKED =
	"0xe52b422ce6b3cd73243c813dcbc499543bb477dd997c5d177b52c03562347ce5"; // Revoked(bytes32 indexed key, address indexed challenger, uint32 vectorIndex)
const STOPPED =
	"0xc167316d53fbdff5ab2c8e45514426acd104c84efb1e239fe4b517ebb32ba88e"; // Stopped(bytes32 indexed key, address indexed by)
/** The archive endpoint refuses log reads over 50,000 blocks (CLAUDE.md, "RPC notes"). */
const LOG_SPAN = 50_000n;
const ST_REVOKED = 2;
const ST_COOLING = 3;

type Circuit = readonly [processor: Address, id: bigint];

const P0 = "0x50a994e71615474b55559ff4f500928fbc339dd9"; // processor 0, can't mine
const MINE6 = "0x1f5cb4aeae1807bf60c3b9c0d8adbcc14e91f12c"; // eligible, multiplier 6
const WRAPS = "0xc1ae0d87cde4f93bcae38c6d62a269c76d5d3215"; // 120 pure wrappers of one circuit

// The cases. Each one is explained in fixtures/README.md. REF targets are recorded too.
const CASES: Circuit[] = [
	// Wrappers
	[P0, 6534n], // one REF to P0/5388
	[MINE6, 38n], // one REF to P0/1 (1,204 gates), on a processor that can mine
	[WRAPS, 106n], // identical wrappers of MINE6/512
	[WRAPS, 109n],
	[MINE6, 42n], // wrapper of MINE6/3, which has gates of its own: the chain stops there
	[MINE6, 68n], // several REF records, all to MINE6/1
	// REF records mixed with real gates
	[MINE6, 3n], // 176 NANDs and 2 REFs to P0/1
	// Byte-identical 1,204-gate circuits on three processors, none of them a miner
	[P0, 1n],
	["0x54840f62c9d6cf322a3972a6be0be16e76077cc0", 1n],
	["0xd3c3a93ca6cacc50b303cac1e51580cd95632509", 3n],
	// Small identical circuits (3 gates)
	[P0, 42n],
	[P0, 189n],
	[P0, 406n],
	[P0, 1251n],
	// Identical 603-gate miners on one processor, and a 603-gate circuit on one that can't mine
	[MINE6, 1008n],
	[MINE6, 1144n],
	[MINE6, 1147n],
	["0xf4412c52ec3ddf7caf5f518b6662f77b02bde28e", 63n],
	// Identical once NAND inputs are sorted, different bytes
	[MINE6, 1510n],
	[MINE6, 1570n],
	[MINE6, 967n],
	[MINE6, 1784n],
	[MINE6, 2397n],
	// Identical miners where the later tape-out has the earlier design commitment
	[MINE6, 2510n],
	[MINE6, 2683n],
	// No identical circuit on its processor
	[MINE6, 153n],
	// One gate on a processor that can mine, identical to the later P0/5388
	[MINE6, 46n],
	// Miner statuses other than active (PodMining: 0 none, 1 active, 2 revoked, 3 cooling)
	[MINE6, 1231n], // never started, no REF
	[MINE6, 1965n], // revoked: a challenge proved it fails a test vector
	[MINE6, 128n], // cooling: stopped by its owner
];

const calls: RpcCall[] = [];
const rec = recordingClient(RPC, calls);
// Finding a tape-out block takes a binary search over past blocks; those calls are not part
// of what a test replays, so they go through a client that isn't recorded.
const plain = createPublicClient({ transport: http(RPC) });

const seen = new Set<string>();

async function record([processor, id]: Circuit, depth: number): Promise<void> {
	const k = `${processor.toLowerCase()}/${id}`;
	if (seen.has(k)) return;
	seen.add(k);

	const netlist = await rec.readContract({
		address: processor,
		abi: processorAbi,
		functionName: "netlist",
		args: [id],
		blockNumber: BLOCK,
	});
	await rec.readContract({
		address: processor,
		abi: processorAbi,
		functionName: "circuitInfo",
		args: [id],
		blockNumber: BLOCK,
	});
	await rec.readContract({
		address: POD_MINING,
		abi: miningAbi,
		functionName: "processorMultiplier",
		args: [processor],
		blockNumber: BLOCK,
	});
	const key = keccak256(encodePacked(["address", "uint256"], [processor, id]));
	const miner = await rec.readContract({
		address: POD_MINING,
		abi: miningAbi,
		functionName: "getMiner",
		args: [key],
		blockNumber: BLOCK,
	});

	const tapedOut = await tapeOutBlock(plain, processor, id);
	const logs = await rec.request({
		method: "eth_getLogs",
		params: [
			{
				address: processor,
				topics: [TAPED_OUT, pad(toHex(id))],
				fromBlock: numberToHex(tapedOut),
				toBlock: numberToHex(tapedOut),
			},
		],
	});
	if (logs.length !== 1) {
		throw new Error(
			`${k}: ${logs.length} TapedOut logs in block ${tapedOut}, expected 1`,
		);
	}
	await rec.getBlock({ blockNumber: tapedOut });

	if (miner.commitBlock > 0n) {
		const commits = await rec.request({
			method: "eth_getLogs",
			params: [
				{
					address: POD_MINING,
					topics: [DESIGN_COMMITTED, null, null, pad(processor)],
					fromBlock: numberToHex(miner.commitBlock),
					toBlock: numberToHex(miner.commitBlock),
				},
			],
		});
		if (commits.length === 0) {
			throw new Error(
				`${k}: no DesignCommitted log in block ${miner.commitBlock}`,
			);
		}
	}

	let statusEvent = "";
	if (miner.status === ST_COOLING) {
		await recordOneLog(STOPPED, key, miner.stopBlock, k);
		statusEvent = `, stopped at ${miner.stopBlock}`;
	} else if (miner.status === ST_REVOKED) {
		const block = await findLogBlock(plain, REVOKED, key, tapedOut);
		await recordOneLog(REVOKED, key, block, k);
		statusEvent = `, revoked at ${block}`;
	}

	console.log(
		`recorded ${k}: ${(netlist.length - 2) / 2} bytes, taped out at ${tapedOut}, miner status ${miner.status}${miner.commitBlock > 0n ? `, commitment at ${miner.commitBlock}` : ""}${statusEvent}`,
	);

	if (depth < MAX_REF_DEPTH) {
		for (const target of refTargets(netlist)) await record(target, depth + 1);
	}
}

/**
 * The first block at which the circuit exists. nextId() returns the last id issued, not the
 * next one, despite TAP-02's wording: it reads 6534 before 0x50a9…/6535 is taped out and 6535
 * after, and PodMining sets firstUnusedId = nextId() + 1.
 */
async function tapeOutBlock(
	client: PublicClient,
	processor: Address,
	id: bigint,
): Promise<bigint> {
	const exists = async (block: bigint) => {
		try {
			const next = await client.readContract({
				address: processor,
				abi: processorAbi,
				functionName: "nextId",
				blockNumber: block,
			});
			return next >= id;
		} catch {
			return false; // the processor didn't exist yet
		}
	};
	let lo = 0n;
	let hi = BLOCK;
	if (!(await exists(hi)))
		throw new Error(`${processor}/${id} doesn't exist at ${BLOCK}`);
	while (hi - lo > 1n) {
		const mid = (lo + hi) / 2n;
		if (await exists(mid)) hi = mid;
		else lo = mid;
	}
	return hi;
}

/** Records the mining contract's one log for this miner key in one block; it must be there. */
async function recordOneLog(
	topic0: Hex,
	key: Hex,
	block: bigint,
	k: string,
): Promise<void> {
	const logs = await rec.request({
		method: "eth_getLogs",
		params: [
			{
				address: POD_MINING,
				topics: [topic0, key],
				fromBlock: numberToHex(block),
				toBlock: numberToHex(block),
			},
		],
	});
	if (logs.length !== 1) {
		throw new Error(
			`${k}: ${logs.length} logs for ${topic0} in block ${block}, expected 1`,
		);
	}
}

/**
 * The first block from `from` holding the mining contract's log for this key, searched in
 * spans the archive endpoint accepts. Not recorded: only the one-block read that follows is.
 */
async function findLogBlock(
	client: PublicClient,
	topic0: Hex,
	key: Hex,
	from: bigint,
): Promise<bigint> {
	for (let start = from; start <= BLOCK; start += LOG_SPAN) {
		const end = start + LOG_SPAN - 1n < BLOCK ? start + LOG_SPAN - 1n : BLOCK;
		const logs = await client.request({
			method: "eth_getLogs",
			params: [
				{
					address: POD_MINING,
					topics: [topic0, key],
					fromBlock: numberToHex(start),
					toBlock: numberToHex(end),
				},
			],
		});
		const first = logs[0];
		if (first?.blockNumber) return BigInt(first.blockNumber);
	}
	throw new Error(`no ${topic0} log for ${key} between ${from} and ${BLOCK}`);
}

/** REF targets, read only far enough to find them. The netlist reader proper is built test first. */
function refTargets(netlist: Hex): Circuit[] {
	const b = Buffer.from(netlist.slice(2), "hex");
	const out: Circuit[] = [];
	let p = 0;
	while (p < b.length) {
		const op = b[p];
		if (op === 0) p += 7;
		else if (op === 1) p += 4;
		else if (op === 2) {
			const processor =
				`0x${b.subarray(p + 1, p + 21).toString("hex")}` as Address;
			const id = b.readBigUInt64BE(p + 21);
			out.push([processor, id]);
			p += 31 + 3 * (b[p + 29] ?? 0);
		} else throw new Error(`unknown opcode ${op} at byte ${p}`);
	}
	return out;
}

for (const c of CASES) await record(c, 0);

const unique = [
	...new Map(
		calls.map((c) => [JSON.stringify([c.method, c.params]), c]),
	).values(),
];
const out = new URL(`../fixtures/bnb-circuits-${BLOCK}.json`, import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({ chainId: 56, block: String(BLOCK), recordedAt: new Date().toISOString(), calls: unique }, null, "\t")}\n`,
);
console.log(`${seen.size} circuits, ${unique.length} calls → ${out.pathname}`);
