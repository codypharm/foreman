// The netlist hash (docs/decisions/2026-11-20-verdict-scope-and-earliest-design.md, decision 5).
//
//   netlistHash = keccak256(abi.encodePacked(uint32 nIn, uint32 nOut, bytes sorted))
//   byteHash    = keccak256(abi.encodePacked(uint32 nIn, uint32 nOut, bytes netlist))
//
// `sorted` is the netlist with each NAND record's two inputs in ascending order; LATCH and REF
// records are unchanged. Swapping a NAND's inputs never changes what a circuit does, so a
// copy with swapped inputs gets the same netlistHash. A copy with gates reordered does not.

import { type Hex32, parseHex32 } from "@foreman/contract";
import { encodePacked, keccak256 } from "viem";
import type { Netlist } from "./read-netlist.ts";

export interface NetlistHashes {
	/** Same for netlists that differ only by swapped NAND inputs. Finds copies. */
	netlistHash: Hex32;
	/** Same only for byte-identical netlists. Evidence beside netlistHash. */
	byteHash: Hex32;
}

export function hashNetlist(netlist: Netlist): NetlistHashes {
	const raw = Buffer.from(netlist.bytes.slice(2), "hex");
	const sorted = Buffer.from(raw);
	let p = 0;
	for (const r of netlist.records) {
		if (r.op === "nand") {
			const [lo, hi] = r.a <= r.b ? [r.a, r.b] : [r.b, r.a];
			sorted.writeUIntBE(lo, p + 1, 3);
			sorted.writeUIntBE(hi, p + 4, 3);
			p += 7;
		} else if (r.op === "latch") p += 4;
		else p += 31 + 3 * r.nIns;
	}
	const hash = (bytes: Buffer, field: string) =>
		parseHex32(
			keccak256(
				encodePacked(
					["uint32", "uint32", "bytes"],
					[netlist.nIn, netlist.nOut, `0x${bytes.toString("hex")}`],
				),
			),
			field,
		);
	return {
		netlistHash: hash(sorted, "netlistHash"),
		byteHash: hash(raw, "byteHash"),
	};
}
