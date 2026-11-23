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
import { LoadingNote, Shape } from "../../components/Shape.tsx";
import { formatCount, shortHex } from "../../format.ts";
import { CAN_MINE } from "./circuit-words.ts";
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
		<div className={s.page} aria-busy={page.isPending}>
			{page.data ? (
				<>
					<main>
						<Header page={page.data} />
						<Originality check={page.data.check} />
						<Worth page={page.data} />
					</main>
					<Options page={page.data} />
				</>
			) : page.isError ? (
				<main>
					<div className={s.who}>
						<span className={s.badge} aria-hidden="true">
							#
						</span>
						<h1>Circuit #{id}</h1>
					</div>
					<div className={s.problem} role="alert">
						{page.error instanceof ApiProblem
							? page.error.problem.detail
							: "Something went wrong reading this circuit."}
						<br />
						<button type="button" onClick={() => page.refetch()}>
							Try again
						</button>
					</div>
				</main>
			) : (
				<PageShape id={id} />
			)}
		</div>
	);
}

/** Loading A: the page's shape while its live reads arrive, the circuit number shown at once. */
function PageShape({ id }: { id: string }) {
	return (
		<>
			<main>
				<LoadingNote>
					Reading circuit #{id}, its miner and its market from BNB Chain and X
					Layer.
				</LoadingNote>
				<div className={s.who}>
					<span className={s.badge} aria-hidden="true">
						#
					</span>
					<div>
						<h1>Circuit #{id}</h1>
						<Shape w={180} h={20} mt={6} />
					</div>
				</div>
				<section className={`${s.q} ${s.first}`}>
					<div className={s.sec}>
						<h2>Original?</h2>
					</div>
					<Shape w="70%" h={22} mt={20} />
					<Shape w="90%" h={14} mt={12} />
					<Shape w="60%" h={14} mt={8} />
				</section>
				<section className={s.q}>
					<div className={s.sec}>
						<h2>Worth?</h2>
					</div>
					<Shape w={240} h={36} r={999} mt={16} />
					<Shape w="55%" h={64} r={12} mt={20} />
					<Shape h={4} mt={24} />
				</section>
			</main>
			<aside className={s.side}>
				<div className={s.sec}>
					<h2>Options</h2>
				</div>
				{["Hold", "Sell", "Lend", "Rent"].map((o) => (
					<div key={o} className={s.shapeRow}>
						<Shape w={56} h={16} />
						<Shape w="80%" h={12} mt={10} />
					</div>
				))}
			</aside>
		</>
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
