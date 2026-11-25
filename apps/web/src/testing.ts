// The web tests' real fixtures were recorded on 23 Nov 2026, before Originality gained `mining` and
// `index.upTo` (2026-11-25-fabx-copy-check.md). This rewrites a recorded result in today's shape,
// as the republish does (2026-11-25-republish-in-new-shape.md): every one of them is a BNB Chain
// circuit, and a miner's mining contract is TapeOut's.

type Recorded = {
	scope: string;
	index: { upToBlock: unknown; [k: string]: unknown };
	[k: string]: unknown;
};

const POD = {
	chainId: 56,
	contract: "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46",
};

export function inTodaysShape<T extends Recorded>(
	recorded: T,
): Omit<T, "index"> & {
	mining: typeof POD | null;
	index: Omit<T["index"], "upToBlock"> & { upTo: unknown[] };
} {
	const { upToBlock, ...index } = recorded.index;
	return {
		...recorded,
		mining: recorded.scope === "miner" ? POD : null,
		index: { ...index, upTo: [upToBlock] },
	} as never;
}
