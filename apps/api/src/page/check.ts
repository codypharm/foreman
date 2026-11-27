// The Check box: what was typed, and the one circuit it names (docs/decisions/2026-11-22-check-box-input.md;
// the answer's shape from docs/decisions/2026-11-21-api-endpoints.md). A bare number is a market
// listing number. Whatever isn't found says so in plain words with the block the index reached; a
// failed read is a failed read, never "not found".

import { readProcessorAt } from "@foreman/chain-bnb";
import { FABX_PROCESSOR, readVoucherCircuit } from "@foreman/chain-xlayer";
import {
	type Address,
	type ApiError,
	type CheckAnswer,
	type Hex32,
	parseAddress,
	parseHex32,
} from "@foreman/contract";
import {
	findListingCircuit,
	findMinerCircuit,
	marketRead,
} from "@foreman/index";
import type pg from "pg";
import { BaseError, type PublicClient } from "viem";

export type CheckInput =
	| { kind: "listing"; id: bigint }
	| { kind: "voucher"; id: bigint }
	| { kind: "miner"; key: Hex32 }
	| { kind: "circuit"; processor: Address; id: bigint }
	/** TapeOut's label: a circuit's id, then its processor's place in the BNB Chain factory. */
	| { kind: "label"; id: bigint; position: bigint };

/** What the Check box accepts, for "Not recognised". */
export const CHECK_ACCEPTS = [
	"a market listing number, such as 28074 or listing 28074",
	"a RIG voucher number, such as RIG voucher #19",
	"a miner key: 0x followed by 64 hexadecimal characters",
	"a circuit: its processor address, then its id, such as 0x1f5c…912c 2421",
	"a FabX circuit: FabX, then its id, such as FabX 1234",
	"a circuit as TapeOut’s BNB Chain market labels it, such as 13931.30",
];

const NUMBER = "#?\\s*([1-9]\\d{0,77})";
const LISTING = new RegExp(`^(?:listing\\s*)?${NUMBER}$`, "i");
const VOUCHER = new RegExp(
	`^(?:rig\\s*voucher|rig|voucher)\\s*${NUMBER}$`,
	"i",
);
/** FabX's circuits on X Layer by their id (2026-11-25-fabx-copy-check.md, decision 8). */
const FABX = new RegExp(`^fabx\\s*${NUMBER}$`, "i");
/** "13931.30", as TapeOut's market labels a circuit (2026-11-27-tapeout-circuit-label.md). */
const LABEL = /^([1-9]\d{0,77})\.(0|[1-9]\d{0,9})$/;
const MINER = /^0x[0-9a-f]{64}$/i;
const CIRCUIT = /^(0x[0-9a-f]{40})\s*(?:[\s/#]|\/#)\s*#?\s*([1-9]\d{0,77})$/i;

/** The kind of input, or null when it isn't one the Check box accepts. */
export function readCheckInput(q: string): CheckInput | null {
	const s = q.trim();
	if (MINER.test(s))
		return { kind: "miner", key: parseHex32(s.toLowerCase(), "q") };
	const circuit = CIRCUIT.exec(s);
	if (circuit) {
		return {
			kind: "circuit",
			processor: parseAddress((circuit[1] as string).toLowerCase(), "q"),
			id: BigInt(circuit[2] as string),
		};
	}
	const fabx = FABX.exec(s);
	if (fabx) {
		return {
			kind: "circuit",
			processor: parseAddress(FABX_PROCESSOR, "q"),
			id: BigInt(fabx[1] as string),
		};
	}
	const label = LABEL.exec(s);
	if (label) {
		return {
			kind: "label",
			id: BigInt(label[1] as string),
			position: BigInt(label[2] as string),
		};
	}
	const voucher = VOUCHER.exec(s);
	if (voucher) return { kind: "voucher", id: BigInt(voucher[1] as string) };
	const listing = LISTING.exec(s);
	if (listing) return { kind: "listing", id: BigInt(listing[1] as string) };
	return null;
}

export type CheckRead =
	| { ok: true; answer: CheckAnswer }
	| { ok: false; error: ApiError };

export async function resolveCheck(
	deps: { pool: pg.Pool; xlayer: PublicClient; bnb: PublicClient },
	q: string,
): Promise<CheckRead> {
	const input = readCheckInput(q);
	if (!input) {
		return {
			ok: false,
			error: {
				error: "not-recognised",
				detail: "That isn’t a listing, RIG voucher, miner key or circuit",
				accepted: CHECK_ACCEPTS,
			},
		};
	}
	switch (input.kind) {
		case "circuit":
			// The result page says whether the index holds it
			return found(input.processor, input.id);

		case "listing": {
			try {
				await marketRead(deps.pool);
			} catch (error) {
				return fail("not-ready", plain(error));
			}
			try {
				const l = await findListingCircuit(deps.pool, input.id);
				if (l.found) return found(l.circuit.processor, l.circuit.id);
				return fail(
					"unknown-circuit",
					l.reason === "withdrawn"
						? `Listing ${input.id} was withdrawn, so Foreman doesn’t know its circuit. Paste the circuit or its miner key instead.`
						: `No listing ${input.id} on TapeOut’s circuit market up to BNB block ${count(l.marketBlock)}`,
				);
			} catch (error) {
				return fail("read-failed", plain(error));
			}
		}

		case "miner": {
			try {
				const m = await findMinerCircuit(deps.pool, input.key);
				if (m.found) return found(m.circuit.processor, m.circuit.id);
				return fail(
					"unknown-circuit",
					`No miner with that key in the index up to BNB block ${count(m.minersBlock)}${
						m.fabxMinersBlock === null
							? ""
							: ` or among FabX’s miners up to X Layer block ${count(m.fabxMinersBlock)}`
					}`,
				);
			} catch (error) {
				const detail = plain(error);
				return fail(
					/not read yet/.test(detail) ? "not-ready" : "read-failed",
					detail,
				);
			}
		}

		case "label": {
			// TapeOut's BNB Chain label; the result page says whether the index holds the circuit
			try {
				const blockNumber = await deps.bnb.getBlockNumber();
				const p = await readProcessorAt(deps.bnb, {
					position: input.position,
					blockNumber,
				});
				if (p.found) return found(p.processor, input.id);
				return fail(
					"unknown-circuit",
					`No processor #${input.position} in TapeOut’s BNB Chain factory, which had ${count(p.count)} at BNB block ${count(p.blockNumber)}`,
				);
			} catch (error) {
				return fail(
					"read-failed",
					`Reading processor #${input.position} on BNB Chain failed: ${plain(error)}`,
				);
			}
		}

		case "voucher": {
			try {
				const blockNumber = await deps.xlayer.getBlockNumber();
				const v = await readVoucherCircuit(deps.xlayer, {
					voucherId: input.id,
					blockNumber,
				});
				if (v.circuit) return found(v.circuit.processor, v.circuit.id);
				return fail(
					"unknown-circuit",
					`No live RIG voucher #${input.id} on X Layer: it was never minted or has been redeemed.`,
				);
			} catch (error) {
				return fail(
					"read-failed",
					`Reading RIG voucher #${input.id} on X Layer failed: ${plain(error)}`,
				);
			}
		}
	}
}

function found(processor: string, tokenId: bigint): CheckRead {
	return {
		ok: true,
		answer: { processor: parseAddress(processor, "processor"), tokenId },
	};
}

function fail(
	error: Exclude<ApiError["error"], "not-recognised">,
	detail: string,
): CheckRead {
	return { ok: false, error: { error, detail } };
}

const count = (n: bigint) => n.toLocaleString("en");

/** Plain words for the screen: viem's short message, never the node's URL or the call's data. */
function plain(error: unknown): string {
	if (error instanceof BaseError) return error.shortMessage;
	return error instanceof Error ? error.message : String(error);
}
