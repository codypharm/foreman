// Test helpers: changed copies of a saved fixture, for cases the chain never produces.

import type { Fixture } from "@foreman/chain-bnb/fixture";

/** A copy of the fixture whose saved netlist(id) response holds other bytes. */
export function withNetlist(
	f: Fixture,
	processor: string,
	id: bigint,
	bytes: string,
): Fixture {
	const data = `0x3fc4be56${id.toString(16).padStart(64, "0")}`;
	const body = bytes.slice(2);
	const len = (body.length / 2).toString(16).padStart(64, "0");
	const padded = body.padEnd(Math.ceil(body.length / 64) * 64, "0");
	const result = `0x${"20".padStart(64, "0")}${len}${padded}`;
	let replaced = 0;
	const calls = f.calls.map((c) => {
		const p = (c.params as unknown[])[0] as { to?: string; data?: string };
		if (c.method !== "eth_call" || p.to !== processor || p.data !== data)
			return c;
		replaced++;
		return { ...c, result };
	});
	if (replaced !== 1)
		throw new Error(
			`expected one saved netlist(${id}) call, found ${replaced}`,
		);
	return { ...f, calls };
}
