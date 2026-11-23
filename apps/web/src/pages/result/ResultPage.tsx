// One circuit's result page (docs/mocks/2026-11-21-result-page.html; a miner held for a RIG voucher as
// in 2026-11-22-voucher-held.html): Original?, Worth?, What it's based on, Options and Published, all
// from GET /circuit/:processor/:tokenId. Nothing here decides a verdict or a value.

import type {
	CantMineReason,
	CircuitPage,
	OriginalityFact,
} from "@foreman/contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "wouter";
import { ApiProblem, fetchCircuit } from "../../api.ts";
import { formatCount, shortHex } from "../../format.ts";
import { Options } from "./Options.tsx";
import { Originality } from "./Originality.tsx";
import s from "./ResultPage.module.css";
import { Worth } from "./Worth.tsx";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TOKEN_ID = /^\d{1,78}$/;

export function ResultPage({
	processor,
	tokenId,
}: {
	processor: string;
	tokenId: string;
}) {
	const valid = ADDRESS.test(processor) && TOKEN_ID.test(tokenId);
	const id = valid ? BigInt(tokenId).toString() : tokenId;
	const page = useQuery({
		queryKey: ["circuit", processor.toLowerCase(), id],
		queryFn: () => fetchCircuit(processor.toLowerCase(), id),
		enabled: valid,
	});

	useEffect(() => {
		document.title = `Foreman · Circuit #${id}`;
		return () => {
			document.title = "Foreman · Live listings";
		};
	}, [id]);

	if (!valid) {
		return (
			<div className={s.page}>
				<main>
					<p className={s.problem} role="alert">
						That isn’t a circuit address: a processor (0x followed by 40
						hexadecimal characters) and a token id.{" "}
						<Link href="/">See today’s listings</Link>.
					</p>
				</main>
			</div>
		);
	}

	return (
		<div className={s.page}>
			{page.data ? (
				<>
					<main>
						<Header page={page.data} />
						<Originality check={page.data.check} />
						<Worth page={page.data} />
					</main>
					<Options page={page.data} />
				</>
			) : (
				<main>
					<div className={s.who}>
						<span className={s.badge} aria-hidden="true">
							#
						</span>
						<h1>Circuit #{id}</h1>
					</div>
					{page.isError ? (
						<div className={s.problem} role="alert">
							{page.error instanceof ApiProblem
								? page.error.problem.detail
								: "Something went wrong reading this circuit."}
							<br />
							<button type="button" onClick={() => page.refetch()}>
								Try again
							</button>
						</div>
					) : (
						<p className={s.waiting}>
							Reading the circuit, its miner and its market from BNB Chain and X
							Layer…
						</p>
					)}
				</main>
			)}
		</div>
	);
}

function Header({ page }: { page: CircuitPage }) {
	const facts =
		page.check.state === "checked" ? page.check.originality.facts : [];
	const canMine = facts.find(
		(f): f is Extract<OriginalityFact, { fact: "can-mine" }> =>
			f.fact === "can-mine",
	);
	const bonus = facts.find(
		(f): f is Extract<OriginalityFact, { fact: "design-bonus" }> =>
			f.fact === "design-bonus",
	);
	return (
		<>
			<div className={s.who}>
				<span className={s.badge} aria-hidden="true">
					#
				</span>
				<div>
					<h1>Circuit #{page.circuit.tokenId.toString()}</h1>
					<div className={s.chips}>
						{canMine && (
							<span
								className={
									canMine.state === "mining" ? `${s.chip} ${s.ok}` : s.chip
								}
							>
								{CAN_MINE[canMine.state]}
							</span>
						)}
						{page.voucher && (
							<span className={`${s.chip} ${s.rig}`}>
								RIG voucher #{page.voucher.voucherId.toString()}
							</span>
						)}
						{bonus && (
							<span className={s.chip}>
								{bonus.holds
									? "Holds the design bonus"
									: "Doesn’t hold the design bonus"}
							</span>
						)}
						{page.miner?.taskId != null && (
							<span className={s.chip}>Task {page.miner.taskId}</span>
						)}
						<span className={s.chip}>Processor ×{page.multiplier}</span>
					</div>
				</div>
			</div>
			{page.voucher && (
				<p className={s.held}>
					Held in the rig vault for{" "}
					<b>RIG voucher #{page.voucher.voucherId.toString()}</b> on X Layer.
					The holder,{" "}
					<span className={s.mono}>{shortHex(page.voucher.holder)}</span>, gets
					its BEM.
				</p>
			)}
			{canMine?.state === "cant-mine" && (
				<p className={s.held}>
					Can’t mine: {canMine.reasons.map(cantMine).join("; ")}.
				</p>
			)}
			{canMine?.state === "stopped" && (
				<p className={s.held}>
					Stopped at BNB block {formatCount(canMine.stoppedAt)}. It can start
					again from block {formatCount(canMine.canStartFrom)}.
				</p>
			)}
		</>
	);
}

const CAN_MINE = {
	mining: "Mining now",
	"cant-mine": "Can’t mine",
	stopped: "Not mining: stopped",
	"not-started": "Could mine: not started",
} as const;

function cantMine(r: CantMineReason): string {
	switch (r.reason) {
		case "processor-not-eligible":
			return "its processor isn’t eligible";
		case "uses-ref":
			return "it uses REF records";
		case "failed-test-vector":
			return `it failed test vector ${r.vectorIndex} of task ${r.taskId} at BNB block ${formatCount(r.block)}`;
	}
}
