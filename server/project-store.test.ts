import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "./project-store.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ProjectStore", () => {
  it("creates an Archipelago project with specialist lanes", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-project-test-"));
    tempDirs.push(dir);
    const store = new ProjectStore(dir);
    const project = store.createProject({ name: "Crystal AP World", kind: "archipelago-world", tags: ["ap", "qa", "ap"] });

    expect(project.slug).toBe("crystal-ap-world");
    expect(project.lanes.map((lane) => lane.id)).toEqual(
      expect.arrayContaining(["world-development", "qa", "bug-triage", "discord-research", "github-research", "docs-release"]),
    );
    expect(project.tags).toEqual(["ap", "qa"]);
  });

  it("keeps bot assignments and work items across reloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-project-test-"));
    tempDirs.push(dir);
    const store = new ProjectStore(dir);
    const project = store.createProject({ name: "Recomp Lab", kind: "recomp" });
    const assignment = store.assignBot({ projectId: project.id, botId: "bot-1", laneId: "qa", roleName: "QA lead" });
    const item = store.createWorkItem({
      projectId: project.id,
      laneId: "qa",
      kind: "bug",
      title: "Save state regression",
      priority: "high",
      assigneeBotId: "bot-1",
      evidence: [{ kind: "test", ref: "tests/save-state.spec.ts" }],
    });

    const reloaded = new ProjectStore(dir);
    expect(reloaded.contextForBot("bot-1")).toMatchObject({
      projects: [{ project: { id: project.id }, assignments: [{ id: assignment.id, roleName: "QA lead" }] }],
    });
    expect(reloaded.workItem(item.id)).toMatchObject({ title: "Save state regression", evidence: [{ kind: "test" }] });
    expect(reloaded.promptForBot("bot-1")).toContain("Save state regression");
  });

  it("does not duplicate a project when a bot owns multiple lanes", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-project-test-"));
    tempDirs.push(dir);
    const store = new ProjectStore(dir);
    const project = store.createProject({ name: "Multi-lane World", kind: "archipelago-world" });
    store.assignBot({ projectId: project.id, botId: "bot-1", laneId: "qa" });
    store.assignBot({ projectId: project.id, botId: "bot-1", laneId: "discord-research" });

    const context = store.contextForBot("bot-1");
    expect(context.projects).toHaveLength(1);
    expect(context.projects[0].assignments).toHaveLength(2);
  });
});
