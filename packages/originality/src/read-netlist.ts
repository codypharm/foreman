// Reads one circuit's netlist from its processor contract and decodes it into records, per
// TAP-02 §2 (docs/notes/2026-11-20-netlist-storage.md). Read only. Netlist bytes are
// untrusted input: every record's length is checked before it is read.

import type { Address, Hex, PublicClient } from "viem";

export type NetlistRecord =
	| { op: "nand"; a: number; b: number }
	| { op: "latch"; d: number }
	| {
			op: "ref";
			/** The circuit whose outputs this record reuses. */
			target: { processor: Address; id: bigint };
			nIns: number;
			nOuts: number;
			/** The signals wired to the target's inputs, in order. */
			inputs: number[];
	  };

export interface Netlist {
	processor: Address;
	id: bigint;
	nIn: number;
	nOut: number;
	nState: number;
	/** From circuitInfo: includes gates reached through REF records. */
	gateCount: number;
	bytes: Hex;
	records: NetlistRecord[];
}

export type NetlistRead =
	| { readable: true; netlist: Netlist }
	/** Shown as "Can't check", never as "No earlier copy found". */
	| {
			readable: false;
			reason: "netlist-unreadable" | "read-failed";
			detail: string;
	  };

const processorAbi = [
	{
		name: "netlist",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "id", type: "uint256" }],
		outputs: [{ name: "", type: "bytes" }],
	},
	{
		name: "circuitInfo",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "id", type: "uint256" }],
		outputs: [
			{ name: "nIn", type: "uint32" },
			{ name: "nOut", type: "uint32" },
			{ name: "nState", type: "uint32" },
			{ name: "gateCount", type: "uint32" },
		],
	},
] as const;

export async function readNetlist(
	client: PublicClient,
	circuit: { processor: Address; id: bigint },
	at: { blockNumber: bigint },
): Promise<NetlistRead> {
	const { processor, id } = circuit;
	const { blockNumber } = at;
	let read: [Hex, readonly [number, number, number, number]];
	try {
		read = await Promise.all([
			client.readContract({
				address: processor,
				abi: processorAbi,
				functionName: "netlist",
				args: [id],
				blockNumber,
			}),
			client.readContract({
				address: processor,
				abi: processorAbi,
				functionName: "circuitInfo",
				args: [id],
				blockNumber,
			}),
		]);
	} catch (error) {
		// viem's full message names the RPC URL, which can carry a key: keep only its short message
		const short =
			(error as { shortMessage?: string }).shortMessage ?? "read failed";
		return {
			readable: false,
			reason: "read-failed",
			detail: `${processor}/${id} at block ${blockNumber}: ${short}`,
		};
	}
	const [bytes, [nIn, nOut, nState, gateCount]] = read;
	const decoded = decodeNetlist(bytes);
	if ("unreadable" in decoded) {
		return {
			readable: false,
			reason: "netlist-unreadable",
			detail: `${processor}/${id} at block ${blockNumber}: ${decoded.unreadable}`,
		};
	}
	return {
		readable: true,
		netlist: {
			processor,
			id,
			nIn,
			nOut,
			nState,
			gateCount,
			bytes,
			records: decoded.records,
		},
	};
}

/** REF header before its inputs: opcode, cpu, id, nIns, nOuts. */
const REF_HEADER = 31;

/** Decodes netlist bytes into records, or says why they don't decode. Used by readNetlist. */
export function decodeNetlist(
	hex: Hex,
): { records: NetlistRecord[] } | { unreadable: string } {
	const b = Buffer.from(hex.slice(2), "hex");
	const u24 = (at: number) => b.readUIntBE(at, 3);
	const records: NetlistRecord[] = [];
	let p = 0;
	const short = (need: number) => p + need > b.length;
	while (p < b.length) {
		const op = b[p];
		const cut = (what: string) => ({
			unreadable: `${what} at byte ${p} runs past the end (${b.length} bytes)`,
		});
		if (op === 0) {
			if (short(7)) return cut("NAND");
			records.push({ op: "nand", a: u24(p + 1), b: u24(p + 4) });
			p += 7;
		} else if (op === 1) {
			if (short(4)) return cut("LATCH");
			records.push({ op: "latch", d: u24(p + 1) });
			p += 4;
		} else if (op === 2) {
			// cpu:20 bytes, id:u64, nIns:u8, nOuts:u8, ins:u24 × nIns
			if (short(REF_HEADER)) return cut("REF");
			const nIns = b[p + 29] ?? 0;
			if (short(REF_HEADER + 3 * nIns)) return cut("REF");
			const processor =
				`0x${b.subarray(p + 1, p + 21).toString("hex")}` as Address;
			const inputs = Array.from({ length: nIns }, (_, k) =>
				u24(p + 31 + 3 * k),
			);
			records.push({
				op: "ref",
				target: { processor, id: b.readBigUInt64BE(p + 21) },
				nIns,
				nOuts: b[p + 30] ?? 0,
				inputs,
			});
			p += 31 + 3 * nIns;
		} else {
			return { unreadable: `unknown opcode ${op} at byte ${p}` };
		}
	}
	return { records };
}
