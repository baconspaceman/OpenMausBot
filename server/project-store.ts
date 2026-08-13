// Project orchestration persistence. This is intentionally UI-neutral: the
// desktop app, a future web cockpit, and agent tools all consume the same
// project/work-item/assignment contract.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { newId } from "./contracts.ts";

export type ProjectKind = "archipelago-world" | "recomp" | "mod" | "research" | "general";
export type ProjectStatus = "active" | "paused" | "archived";
export type ProjectLaneKind =
  | "world-development"
  | "qa"
  | "bug-triage"
  | "discord-research"
  | "github-research"
  | "docs-release"
  | "recomp-engineering"
  | "mod-engineering"
  | "general";
export type WorkItemKind = "task" | "bug" | "qa" | "research" | "conversation" | "release";
export type WorkItemStatus = "backlog" | "in-progress" | "blocked" | "done" | "wont-do";
export type WorkItemPriority = "low" | "normal" | "high" | "critical";
export type EvidenceKind = "discord-thread" | "discord-message" | "github" | "file" | "url" | "test";

export interface ProjectLane {
  id: string;
  name: string;
  kind: ProjectLaneKind;
  description: string;
}

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  kind: ProjectKind;
  description: string;
  rootPath?: string;
  repositoryUrl?: string;
  tags: string[];
  /** Names of optional MCP tool bundles enabled for this project. */
  mcpTools: string[];
  status: ProjectStatus;
  lanes: ProjectLane[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectAssignment {
  id: string;
  projectId: string;
  botId: string;
  laneId: string;
  roleName: string;
  instructions: string;
  status: "active" | "paused";
  createdAt: number;
  updatedAt: number;
}

export interface ProjectEvidence {
  kind: EvidenceKind;
  ref: string;
  label?: string;
}

export interface ProjectWorkItem {
  id: string;
  projectId: string;
  laneId?: string;
  kind: WorkItemKind;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  labels: string[];
  assigneeBotId?: string;
  assigneeRole?: string;
  evidence: ProjectEvidence[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectContext {
  projects: Array<{
    project: ProjectRecord;
    assignments: ProjectAssignment[];
    activeWorkItems: ProjectWorkItem[];
  }>;
}

const DEFAULT_LANES: Record<ProjectKind, Array<Omit<ProjectLane, "id">>> = {
  "archipelago-world": [
    { name: "World development", kind: "world-development", description: "Locations, items, rules, options, generation, and world code." },
    { name: "QA", kind: "qa", description: "Reproducible test plans, generation checks, playability, and regression coverage." },
    { name: "Bug triage", kind: "bug-triage", description: "Turn reports into prioritized, reproducible engineering work." },
    { name: "Discord research", kind: "discord-research", description: "Read-only community research, threads, feedback, and sentiment with evidence." },
    { name: "GitHub research", kind: "github-research", description: "Issues, pull requests, upstream changes, and dependency research." },
    { name: "Docs & release", kind: "docs-release", description: "Documentation, changelogs, release readiness, and handoff state." },
  ],
  recomp: [
    { name: "Recomp engineering", kind: "recomp-engineering", description: "Build, reverse engineering, runtime integration, and tooling." },
    { name: "QA", kind: "qa", description: "Test matrix, runtime checks, compatibility, and regression coverage." },
    { name: "Bug triage", kind: "bug-triage", description: "Reproducible issue intake and prioritization." },
    { name: "Discord research", kind: "discord-research", description: "Community research and feedback with evidence." },
    { name: "Docs & release", kind: "docs-release", description: "Build notes, user docs, release readiness, and handoffs." },
  ],
  mod: [
    { name: "Mod engineering", kind: "mod-engineering", description: "Mod code, assets, integration, and compatibility." },
    { name: "QA", kind: "qa", description: "Install, runtime, compatibility, and regression checks." },
    { name: "Bug triage", kind: "bug-triage", description: "Reproducible issue intake and prioritization." },
    { name: "Discord research", kind: "discord-research", description: "Community research and feedback with evidence." },
    { name: "Docs & release", kind: "docs-release", description: "Install docs, changelogs, release readiness, and handoffs." },
  ],
  research: [
    { name: "Research", kind: "general", description: "Bounded evidence gathering and synthesis." },
    { name: "QA & verification", kind: "qa", description: "Check claims, reproduce findings, and record limitations." },
    { name: "Docs & release", kind: "docs-release", description: "Durable notes, citations, and handoffs." },
  ],
  general: [
    { name: "General work", kind: "general", description: "Primary project work and coordination." },
    { name: "QA", kind: "qa", description: "Verification and regression coverage." },
    { name: "Bug triage", kind: "bug-triage", description: "Reproducible issue intake and prioritization." },
    { name: "Docs & release", kind: "docs-release", description: "Documentation and handoffs." },
  ],
};

function readJson<T>(path: string, fallback: T): T {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value as T;
  } catch {
    return fallback;
  }
}

function cleanSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `project-${Date.now().toString(36)}`;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].slice(0, 50);
}

function lanesFor(kind: ProjectKind): ProjectLane[] {
  return DEFAULT_LANES[kind].map((lane) => ({ ...lane, id: cleanSlug(lane.name) }));
}

export class ProjectStore {
  private readonly projectsPath: string;
  private readonly assignmentsPath: string;
  private readonly workItemsPath: string;
  projects: ProjectRecord[];
  assignments: ProjectAssignment[];
  workItems: ProjectWorkItem[];

  constructor(dataDir = DATA_DIR) {
    mkdirSync(dataDir, { recursive: true });
    this.projectsPath = join(dataDir, "projects.json");
    this.assignmentsPath = join(dataDir, "project-assignments.json");
    this.workItemsPath = join(dataDir, "project-work-items.json");
    this.projects = readJson<ProjectRecord[]>(this.projectsPath, []);
    for (const project of this.projects) {
      project.tags = uniqueStrings(project.tags);
      project.mcpTools = uniqueStrings(project.mcpTools ?? ((project.kind === "recomp" || project.kind === "mod") ? ["reva", "ghidramcp"] : []));
      project.lanes = Array.isArray(project.lanes) && project.lanes.length ? project.lanes : lanesFor(project.kind);
    }
    this.assignments = readJson<ProjectAssignment[]>(this.assignmentsPath, []);
    this.workItems = readJson<ProjectWorkItem[]>(this.workItemsPath, []);
  }

  private save() {
    writeFileSync(this.projectsPath, JSON.stringify(this.projects, null, 2));
    writeFileSync(this.assignmentsPath, JSON.stringify(this.assignments, null, 2));
    writeFileSync(this.workItemsPath, JSON.stringify(this.workItems, null, 2));
  }

  project(id: string) {
    return this.projects.find((project) => project.id === id || project.slug === id) ?? null;
  }

  listProjects(includeArchived = false) {
    return this.projects.filter((project) => includeArchived || project.status !== "archived");
  }

  createProject(input: {
    name: string;
    kind?: ProjectKind;
    description?: string;
    rootPath?: string;
    repositoryUrl?: string;
    tags?: unknown;
    mcpTools?: unknown;
  }): ProjectRecord {
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("project name required");
    const kind = (input.kind ?? "general") as ProjectKind;
    if (!Object.hasOwn(DEFAULT_LANES, kind)) throw new Error(`unsupported project kind '${kind}'`);
    const baseSlug = cleanSlug(name);
    let slug = baseSlug;
    let suffix = 2;
    while (this.projects.some((project) => project.slug === slug)) slug = `${baseSlug}-${suffix++}`;
    const now = Date.now();
    const project: ProjectRecord = {
      id: newId(),
      slug,
      name,
      kind,
      description: String(input.description ?? "").trim(),
      ...(String(input.rootPath ?? "").trim() ? { rootPath: String(input.rootPath).trim() } : {}),
      ...(String(input.repositoryUrl ?? "").trim() ? { repositoryUrl: String(input.repositoryUrl).trim() } : {}),
      tags: uniqueStrings(input.tags),
      mcpTools: uniqueStrings(input.mcpTools ?? ((kind === "recomp" || kind === "mod") ? ["reva", "ghidramcp"] : [])),
      status: "active",
      lanes: lanesFor(kind),
      createdAt: now,
      updatedAt: now,
    };
    this.projects.unshift(project);
    this.save();
    return project;
  }

  patchProject(id: string, patch: Partial<Pick<ProjectRecord, "name" | "description" | "rootPath" | "repositoryUrl" | "tags" | "mcpTools" | "status">>) {
    const project = this.project(id);
    if (!project) return null;
    if (patch.name !== undefined && !String(patch.name).trim()) throw new Error("project name cannot be empty");
    if (patch.status && !["active", "paused", "archived"].includes(patch.status)) throw new Error("invalid project status");
    Object.assign(project, {
      ...patch,
      ...(patch.name !== undefined ? { name: String(patch.name).trim() } : {}),
      ...(patch.description !== undefined ? { description: String(patch.description).trim() } : {}),
      ...(patch.rootPath !== undefined ? { rootPath: String(patch.rootPath).trim() || undefined } : {}),
      ...(patch.repositoryUrl !== undefined ? { repositoryUrl: String(patch.repositoryUrl).trim() || undefined } : {}),
      ...(patch.tags !== undefined ? { tags: uniqueStrings(patch.tags) } : {}),
      ...(patch.mcpTools !== undefined ? { mcpTools: uniqueStrings(patch.mcpTools) } : {}),
      updatedAt: Date.now(),
    });
    this.save();
    return project;
  }

  assignmentsForProject(projectId: string) {
    return this.assignments.filter((assignment) => assignment.projectId === projectId);
  }

  assignmentsForBot(botId: string) {
    return this.assignments.filter((assignment) => assignment.botId === botId && assignment.status === "active");
  }

  workItem(id: string) {
    return this.workItems.find((item) => item.id === id) ?? null;
  }

  assignBot(input: { projectId: string; botId: string; laneId: string; roleName?: string; instructions?: string }) {
    const project = this.project(input.projectId);
    if (!project) throw new Error("project not found");
    const lane = project.lanes.find((candidate) => candidate.id === input.laneId);
    if (!lane) throw new Error(`lane '${input.laneId}' does not exist in this project`);
    const existing = this.assignments.find(
      (assignment) => assignment.projectId === project.id && assignment.botId === input.botId && assignment.laneId === lane.id,
    );
    if (existing) {
      existing.status = "active";
      existing.roleName = String(input.roleName ?? existing.roleName ?? lane.name).trim();
      existing.instructions = String(input.instructions ?? existing.instructions).trim();
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }
    const now = Date.now();
    const assignment: ProjectAssignment = {
      id: newId(),
      projectId: project.id,
      botId: input.botId,
      laneId: lane.id,
      roleName: String(input.roleName ?? lane.name).trim(),
      instructions: String(input.instructions ?? "").trim(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.assignments.push(assignment);
    this.save();
    return assignment;
  }

  patchAssignment(id: string, patch: Partial<Pick<ProjectAssignment, "roleName" | "instructions" | "status">>) {
    const assignment = this.assignments.find((candidate) => candidate.id === id);
    if (!assignment) return null;
    Object.assign(assignment, patch, { updatedAt: Date.now() });
    this.save();
    return assignment;
  }

  pauseAssignmentsForBot(botId: string) {
    let changed = false;
    for (const assignment of this.assignments) {
      if (assignment.botId === botId && assignment.status !== "paused") {
        assignment.status = "paused";
        assignment.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) this.save();
  }

  workItemsForProject(projectId: string, includeDone = false) {
    return this.workItems
      .filter((item) => item.projectId === projectId && (includeDone || !["done", "wont-do"].includes(item.status)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createWorkItem(input: {
    projectId: string;
    laneId?: string;
    kind?: WorkItemKind;
    title: string;
    description?: string;
    status?: WorkItemStatus;
    priority?: WorkItemPriority;
    labels?: unknown;
    assigneeBotId?: string;
    assigneeRole?: string;
    evidence?: unknown;
  }) {
    const project = this.project(input.projectId);
    if (!project) throw new Error("project not found");
    const title = String(input.title ?? "").trim();
    if (!title) throw new Error("work item title required");
    if (input.laneId && !project.lanes.some((lane) => lane.id === input.laneId)) throw new Error("lane does not belong to project");
    const now = Date.now();
    const evidence = Array.isArray(input.evidence)
      ? input.evidence
          .filter((entry) => entry && typeof entry === "object" && typeof (entry as any).kind === "string" && typeof (entry as any).ref === "string")
          .slice(0, 25)
          .map((entry: any) => ({ kind: entry.kind, ref: entry.ref, ...(entry.label ? { label: String(entry.label) } : {}) }))
      : [];
    const item: ProjectWorkItem = {
      id: newId(),
      projectId: project.id,
      ...(input.laneId ? { laneId: input.laneId } : {}),
      kind: input.kind ?? "task",
      title,
      description: String(input.description ?? "").trim(),
      status: input.status ?? "backlog",
      priority: input.priority ?? "normal",
      labels: uniqueStrings(input.labels),
      ...(input.assigneeBotId ? { assigneeBotId: String(input.assigneeBotId) } : {}),
      ...(input.assigneeRole ? { assigneeRole: String(input.assigneeRole) } : {}),
      evidence,
      createdAt: now,
      updatedAt: now,
    };
    this.workItems.unshift(item);
    project.updatedAt = now;
    this.save();
    return item;
  }

  patchWorkItem(id: string, patch: Partial<Pick<ProjectWorkItem, "laneId" | "kind" | "title" | "description" | "status" | "priority" | "labels" | "assigneeBotId" | "assigneeRole" | "evidence">>) {
    const item = this.workItems.find((candidate) => candidate.id === id);
    if (!item) return null;
    const project = this.project(item.projectId);
    if (patch.laneId && project && !project.lanes.some((lane) => lane.id === patch.laneId)) throw new Error("lane does not belong to project");
    if (patch.title !== undefined && !String(patch.title).trim()) throw new Error("work item title cannot be empty");
    Object.assign(item, {
      ...patch,
      ...(patch.title !== undefined ? { title: String(patch.title).trim() } : {}),
      ...(patch.description !== undefined ? { description: String(patch.description).trim() } : {}),
      ...(patch.labels !== undefined ? { labels: uniqueStrings(patch.labels) } : {}),
      updatedAt: Date.now(),
    });
    this.save();
    return item;
  }

  contextForProject(projectId: string): ProjectContext["projects"][number] | null {
    const project = this.project(projectId);
    if (!project) return null;
    return { project, assignments: this.assignmentsForProject(project.id), activeWorkItems: this.workItemsForProject(project.id) };
  }

  contextForBot(botId: string): ProjectContext {
    const projectIds = new Set(this.assignmentsForBot(botId).map((assignment) => assignment.projectId));
    return {
      projects: [...projectIds]
        .map((projectId) => this.contextForProject(projectId))
        .filter((context): context is ProjectContext["projects"][number] => Boolean(context))
        .map((context) => ({
          ...context,
          assignments: context.assignments.filter((assignment) => assignment.botId === botId),
        })),
    };
  }

  promptForBot(botId: string): string {
    const context = this.contextForBot(botId);
    if (!context.projects.length) return "";
    const lines = [
      "PROJECT WORKBENCH CONTEXT",
      "You are working inside one or more explicitly assigned OMB project lanes. Keep project facts, evidence, assumptions, and open work separate. Do not claim a bug is fixed or a QA check passed without evidence.",
    ];
    for (const entry of context.projects) {
      lines.push(`Project: ${entry.project.name} (${entry.project.kind})`);
      lines.push(`Project ID: ${entry.project.id}`);
      lines.push(`Lanes: ${entry.assignments.map((assignment) => assignment.roleName).join(", ") || "Assigned project work"}`);
      for (const assignment of entry.assignments) {
        if (assignment.instructions) lines.push(`${assignment.roleName} instructions: ${assignment.instructions}`);
      }
      if (entry.project.rootPath) lines.push(`Project root: ${entry.project.rootPath}`);
      if (entry.project.repositoryUrl) lines.push(`Repository: ${entry.project.repositoryUrl}`);
      if (entry.project.mcpTools.length) lines.push(`Project MCP bundles: ${entry.project.mcpTools.join(", ")}`);
      const items = entry.activeWorkItems.slice(0, 12);
      if (items.length) {
        lines.push("Open tracked work:");
        for (const item of items) lines.push(`- [${item.priority}] ${item.kind}/${item.status}: ${item.title} (${item.id})`);
      }
    }
    lines.push("Use project tools to inspect context or record work only when the owner asks you to track it. Cite Discord/GitHub/test/file evidence in work items.");
    return lines.join("\n").slice(0, 18_000);
  }
}

export const projectKinds = Object.keys(DEFAULT_LANES) as ProjectKind[];
export const projectLaneKinds = Object.values(DEFAULT_LANES).flatMap((lanes) => lanes.map((lane) => lane.kind));
