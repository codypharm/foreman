// The mining contract panel under the header (docs/mocks/2026-11-25-fabx-result.html, B): the
// mining contract a miner is registered in, named from CLAUDE.md's On-chain facts, never from what
// the contract says about itself. A FabX result adds the fact line and the caveat; while FabX is
// frozen the panel turns red and carries the notice (2026-11-25-fabx-copy-check.md, decisions 2, 6).

import {
	type CircuitPage,
	type FabxCircuitPage,
	isFabxPage,
} from "@foreman/contract";
import type { ReactNode } from "react";
import { formatCount, shortHex } from "../../format.ts";
import s from "./ResultPage.module.css";

/** TapeOut's PoD mining contract on BNB Chain (CLAUDE.md, "On-chain facts", 18 Nov 2026). */
const TAPEOUT_MINING = "0x7e2e0dc66a3bd9103e69b766afa62d9f7b697b46";

export const FABX_FACT =
	"FabX is a mining system on X Layer that mines FAB with circuits from TapeOut’s X Layer factory. It’s separate from TapeOut’s BEM mining, and its contracts are controlled by their own owner.";

export function MiningContract({ page }: { page: CircuitPage }) {
	if (isFabxPage(page)) return <FabxPanel page={page} />;
	const mining =
		page.check.state === "checked" ? page.check.originality.mining : null;
	// Only a miner is registered in a mining contract, and only TapeOut's is followed on BNB Chain
	if (!mining || mining.contract.toLowerCase() !== TAPEOUT_MINING) return null;
	return (
		<div className={s.mc}>
			<Top name="TapeOut · BNB Chain" contract={mining.contract} />
		</div>
	);
}

function FabxPanel({ page }: { page: FabxCircuitPage }) {
	const frozen = page.fabx.frozenAtBlock;
	const readAt = xlayerReadBlock(page);
	return (
		<div className={frozen === null ? s.mc : `${s.mc} ${s.frozen}`}>
			<Top name="FabX · X Layer" contract={page.fabx.contract} />
			<p>{FABX_FACT}</p>
			{frozen === null ? (
				<Watch icon={<Clock />}>
					<b>FabX’s owner can change its mining contract.</b> Read at X Layer
					block {formatCount(readAt)}; Foreman stops FabX results if it does.
				</Watch>
			) : (
				<Watch icon={<Alert />} role="status">
					<b>
						FabX changed its mining contract at X Layer block{" "}
						{formatCount(frozen)}.
					</b>{" "}
					Foreman hasn’t reviewed the change; this result was read at block{" "}
					{formatCount(readAt)}, before it.
				</Watch>
			)}
		</div>
	);
}

/** The X Layer block this page's result was read at: the result's own, else FabX's stored records'. */
function xlayerReadBlock(page: FabxCircuitPage): bigint {
	const fromResult =
		page.check.state === "checked"
			? page.check.originality.index.upTo.find((u) => u.chainId === 196)?.block
			: undefined;
	return fromResult ?? page.miner?.readAtBlock ?? page.fabx.followedTo;
}

function Top({ name, contract }: { name: string; contract: string }) {
	return (
		<div className={s.top}>
			<span>Mining contract</span>
			<b>
				{name}
				<span className={s.mono} title={contract}>
					{shortHex(contract)}
				</span>
			</b>
		</div>
	);
}

function Watch({
	icon,
	role,
	children,
}: {
	icon: ReactNode;
	role?: "status";
	children: ReactNode;
}) {
	return (
		<p className={s.watch} role={role}>
			{icon}
			<span>{children}</span>
		</p>
	);
}

const line = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.6,
	strokeLinecap: "round",
} as const;
const Clock = () => (
	<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
		<circle cx="9" cy="9" r="6.5" {...line} />
		<path d="M9 5.5V9l2.5 1.8" {...line} />
	</svg>
);
const Alert = () => (
	<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
		<circle cx="9" cy="9" r="6.5" {...line} />
		<path d="M9 5.5v4.5M9 12.5v.01" {...line} />
	</svg>
);
