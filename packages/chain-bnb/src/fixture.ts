// Saved JSON-RPC responses, so reader tests decode real chain data with no network.
// The recorder saves every call a read makes; the replay client answers only those calls
// and fails loudly on anything else, so a test can never quietly reach the network.

import {
	createPublicClient,
	custom,
	decodeFunctionData,
	encodeFunctionResult,
	type Hex,
	type PublicClient,
} from "viem";
import { MULTICALL3, multicall3Abi } from "./abi.ts";
import { BNB_CHAIN, MULTICALL_BATCH } from "./bnb-client.ts";

export interface RpcCall {
	method: string;
	params: unknown;
	result: unknown;
}

export interface Fixture {
	chainId: number;
	block: string;
	recordedAt: string;
	calls: RpcCall[];
}

const callKey = (method: string, params: unknown) =>
	JSON.stringify([method, params ?? []]);

/**
 * A client that answers from a fixture; an unrecorded call throws. A Multicall3 bundle recorded
 * whole is answered as recorded; any other bundle is answered from the recorded single reads inside
 * it, at the same block, as the contract would, and a bundle holding any unrecorded read throws.
 * With `multicall`, the client also bundles reads made together, as the results job's does.
 * `asked` collects each call's method and target.
 */
export function replayClient(
	fixture: Fixture,
	options: { multicall?: boolean; asked?: string[] } = {},
): PublicClient {
	const answers = new Map(
		fixture.calls.map((c) => [callKey(c.method, c.params), c.result]),
	);
	const single = (to: string, data: string, block: unknown) =>
		`${to.toLowerCase()}|${data}|${JSON.stringify(block)}`;
	const singles = new Map<string, unknown>();
	for (const c of fixture.calls) {
		if (c.method !== "eth_call") continue;
		const [p, block] = c.params as [{ to?: string; data?: string }, unknown];
		if (p?.to && p.data) singles.set(single(p.to, p.data, block), c.result);
	}
	return createPublicClient({
		...(options.multicall
			? { chain: BNB_CHAIN, batch: { multicall: MULTICALL_BATCH } }
			: {}),
		transport: custom({
			async request({ method, params }) {
				const k = callKey(method, params);
				const [p, block] = (params ?? []) as [
					{ to?: string; data?: Hex } | undefined,
					unknown,
				];
				options.asked?.push(`${method}:${p?.to?.toLowerCase() ?? ""}`);
				if (answers.has(k)) return answers.get(k);
				if (
					method === "eth_call" &&
					p?.to?.toLowerCase() === MULTICALL3 &&
					p.data
				) {
					const { args } = decodeFunctionData({
						abi: multicall3Abi,
						data: p.data,
					});
					const result = args[0].map((call) => {
						const s = single(call.target, call.callData, block);
						if (!singles.has(s)) {
							throw new Error(
								`No saved response for the bundled read ${call.target} ${call.callData.slice(0, 10)} at ${JSON.stringify(block)}`,
							);
						}
						return { success: true, returnData: singles.get(s) as Hex };
					});
					return encodeFunctionResult({
						abi: multicall3Abi,
						functionName: "aggregate3",
						result,
					});
				}
				throw new Error(
					`No saved response for ${k}. Record it: pnpm --filter @foreman/chain-bnb record`,
				);
			},
		}),
	});
}

/** A client that forwards to a live node and keeps every call and its result. */
export function recordingClient(
	rpcUrl: string,
	calls: RpcCall[],
): PublicClient {
	let id = 0;
	// One recording sees one head, so the replay (which can only give one answer) matches
	let head: unknown;
	return createPublicClient({
		transport: custom({
			async request({ method, params }) {
				if (method === "eth_blockNumber" && head !== undefined) return head;
				const response = await fetch(rpcUrl, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
				});
				const body = (await response.json()) as {
					result?: unknown;
					error?: { message: string };
				};
				if (body.error || !("result" in body)) {
					throw new Error(
						`${method} failed: ${body.error?.message ?? response.status}`,
					);
				}
				calls.push({ method, params: params ?? [], result: body.result });
				if (method === "eth_blockNumber") head = body.result;
				return body.result;
			},
		}),
	});
}
