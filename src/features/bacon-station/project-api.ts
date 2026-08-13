import { api } from "@/state/store";
import type { ProjectContext, ProjectSummary } from "./types";

export async function listProjects(): Promise<ProjectSummary[]> {
  const body = await api("/api/projects");
  return body.projects ?? [];
}

export async function getProjectContext(projectId: string): Promise<ProjectContext> {
  return api(`/api/projects/${encodeURIComponent(projectId)}`);
}

export async function createProject(name: string, kind: string): Promise<ProjectSummary> {
  const body = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, kind }),
  });
  return body.project;
}
