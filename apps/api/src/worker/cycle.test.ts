import { describe, expect, it } from "vitest";
import { runCycle, type Stage, type StageName } from "./cycle.ts";

/** Stages that record the order they ran in. */
function recorded(overrides: Partial<Record<StageName, Stage>> = {}) {
	const ran: StageName[] = [];
	const stage =
		(name: StageName): Stage =>
		async () => {
			ran.push(name);
			const own = overrides[name];
			return own ? own() : { status: "done", summary: `${name} done` };
		};
	return {
		ran,
		stages: {
			follow: stage("follow"),
			fabx: stage("fabx"),
			refresh: stage("refresh"),
			publish: stage("publish"),
		},
	};
}

describe("runCycle", () => {
	it("follows BNB Chain, then FabX, then refreshes, then publishes", async () => {
		const { ran, stages } = recorded();
		const report = await runCycle(stages, () => {});
		expect(ran).toEqual(["follow", "fabx", "refresh", "publish"]);
		expect(report.ok).toBe(true);
	});

	it("a failed FabX follow is reported and the run carries on: BNB Chain's results go ahead", async () => {
		// 2026-11-26-fabx-follow.md, decision 4
		const { ran, stages } = recorded({
			fabx: async () => ({ status: "failed", detail: "logs: node down" }),
		});
		const lines: string[] = [];
		const report = await runCycle(stages, (l) => lines.push(l));
		expect(ran).toEqual(["follow", "fabx", "refresh", "publish"]);
		expect(report.ok).toBe(true);
		expect(report.stages[1]).toEqual({
			name: "fabx",
			outcome: { status: "failed", detail: "logs: node down" },
		});
		expect(lines.join("\n")).toContain(
			"fabx: failed: logs: node down; the run carries on",
		);
	});

	it("runs nothing after a failed follow, so nothing is refreshed or published from a half-read index", async () => {
		const { ran, stages } = recorded({
			follow: async () => ({
				status: "failed",
				detail: "tape-outs: node down",
			}),
		});
		const lines: string[] = [];
		const report = await runCycle(stages, (l) => lines.push(l));
		expect(ran).toEqual(["follow"]);
		expect(report.ok).toBe(false);
		expect(report.stages).toEqual([
			{
				name: "follow",
				outcome: { status: "failed", detail: "tape-outs: node down" },
			},
		]);
		expect(lines.join("\n")).toContain("not run: fabx, refresh, publish");
	});

	it("publishes nothing when the refresh fails", async () => {
		const { ran, stages } = recorded({
			refresh: async () => ({
				status: "failed",
				detail: "the index isn't built",
			}),
		});
		expect((await runCycle(stages, () => {})).ok).toBe(false);
		expect(ran).toEqual(["follow", "fabx", "refresh"]);
	});

	it("turns a thrown error into a failed stage, never a crash", async () => {
		const { ran, stages } = recorded({
			refresh: async () => {
				throw new Error("connection terminated");
			},
		});
		const report = await runCycle(stages, () => {});
		expect(ran).toEqual(["follow", "fabx", "refresh"]);
		expect(report.stages[2]).toEqual({
			name: "refresh",
			outcome: { status: "failed", detail: "connection terminated" },
		});
	});

	it("counts a skipped publish (no key set) as a good run", async () => {
		const { stages } = recorded({
			publish: async () => ({
				status: "skipped",
				summary: "no PUBLISHER_KEY set",
			}),
		});
		const report = await runCycle(stages, () => {});
		expect(report.ok).toBe(true);
		expect(report.stages[3]?.outcome.status).toBe("skipped");
	});
});
