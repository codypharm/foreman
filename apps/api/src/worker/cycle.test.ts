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
			refresh: stage("refresh"),
			publish: stage("publish"),
		},
	};
}

describe("runCycle", () => {
	it("follows, then refreshes, then publishes", async () => {
		const { ran, stages } = recorded();
		const report = await runCycle(stages, () => {});
		expect(ran).toEqual(["follow", "refresh", "publish"]);
		expect(report.ok).toBe(true);
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
		expect(lines.join("\n")).toContain("not run: refresh, publish");
	});

	it("publishes nothing when the refresh fails", async () => {
		const { ran, stages } = recorded({
			refresh: async () => ({
				status: "failed",
				detail: "the index isn't built",
			}),
		});
		expect((await runCycle(stages, () => {})).ok).toBe(false);
		expect(ran).toEqual(["follow", "refresh"]);
	});

	it("turns a thrown error into a failed stage, never a crash", async () => {
		const { ran, stages } = recorded({
			refresh: async () => {
				throw new Error("connection terminated");
			},
		});
		const report = await runCycle(stages, () => {});
		expect(ran).toEqual(["follow", "refresh"]);
		expect(report.stages[1]).toEqual({
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
		expect(report.stages[2]?.outcome.status).toBe("skipped");
	});
});
