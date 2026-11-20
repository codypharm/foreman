// The mining contract's key for a circuit (verified PodMining source).

import { type Hex32, parseHex32 } from "@foreman/contract";
import { type Address, encodePacked, keccak256 } from "viem";

/** keccak256(abi.encodePacked(circuits, circuitId)). */
export function minerKey(circuit: { processor: Address; id: bigint }): Hex32 {
	return parseHex32(
		keccak256(
			encodePacked(["address", "uint256"], [circuit.processor, circuit.id]),
		),
		"minerKey",
	);
}
