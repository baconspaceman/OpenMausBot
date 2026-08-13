import { Boxes, Code2, FolderOpen, Gamepad2, MessageSquare } from "lucide-react";
import type { AgentStatus } from "./types";

export const temporaryRoles = [
  { id: "temporary-qa", name: "Temporary QA specialist", role: "Narrow QA task", color: "bg-forge-copper", status: "testing" as const },
  { id: "temporary-recomp", name: "Temporary recomp specialist", role: "Narrow recomp task", color: "bg-forge-red", status: "thinking" as const },
  { id: "temporary-release", name: "Temporary release checker", role: "Narrow release task", color: "bg-forge-teal", status: "working" as const },
];

export const iconForKind: Record<string, typeof Boxes> = {
  "archipelago-world": Boxes,
  recomp: Gamepad2,
  mod: Code2,
  research: MessageSquare,
  general: FolderOpen,
};

export const statusLabels: Record<AgentStatus, string> = {
  working: "Working",
  testing: "Testing",
  monitoring: "Monitoring",
  idle: "Idle",
  thinking: "Thinking",
};

export function colorForIndex(index: number) {
  return ["bg-forge-red", "bg-forge-teal", "bg-forge-copper", "bg-forge-gold"][index % 4];
}
