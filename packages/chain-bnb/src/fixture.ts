// Saved JSON-RPC responses, so reader tests decode real chain data with no network.
// The recorder saves every call a read makes; the replay client answers only those calls
// and fails loudly on anything else, so a test can never quietly reach the network.

import { createPublicClient, custom, type PublicClient } from "viem";

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

/** A client that answers from a fixture; an unrecorded call throws. */
export function replayClient(fixture: Fixture): PublicClient {
	const answers = new Map(
		fixture.calls.map((c) => [callKey(c.method, c.params), c.result]),
	);
	return createPublicClient({
		transport: custom({
			async request({ method, params }) {
				const k = callKey(method, params);
				if (!answers.has(k)) {
					throw new Error(
						`No saved response for ${k}. Record it: pnpm --filter @foreman/chain-bnb record`,
					);
				}
				return answers.get(k);
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
	return createPublicClient({
		transport: custom({
			async request({ method, params }) {
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
				return body.result;
			},
		}),
	});
}
