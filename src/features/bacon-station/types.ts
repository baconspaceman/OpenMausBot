export type WorkspaceTab = "code" | "test" | "evidence";
export type AgentStatus = "working" | "testing" | "monitoring" | "idle" | "thinking";

export interface ProjectSummary {
  id: string;
  name: string;
  kind: string;
  lanes: Array<{ id: string; name: string; kind: string }>;
  openWorkItemCount: number;
  assignmentCount: number;
}

export interface ProjectContext {
  project: ProjectSummary & {
    description?: string;
    rootPath?: string;
    repositoryUrl?: string;
    mcpTools?: string[];
  };
  assignments: Array<{ id: string; botId: string; laneId: string; roleName: string; status: string }>;
  activeWorkItems: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    laneId?: string;
    evidence?: Array<{ label?: string; ref: string }>;
  }>;
}

export interface RoomAgent {
  id: string;
  name: string;
  role: string;
  color: string;
  status: AgentStatus;
  temporary?: boolean;
}

export interface RoomMessage {
  id: string;
  agent: string;
  role: string;
  text: string;
  at: string;
  accent: string;
}
