import type { McpServerEndpoint } from "./contracts.ts";
import type { AppConfig } from "./config.ts";

const DEFAULT_DISCORD_URL = "http://127.0.0.1:8766/mcp";
// The user's Codex config may already contain a stdio server named `discord`.
// Keep OMB's managed HTTP route distinct so Codex cannot merge two transports.
const DEFAULT_DISCORD_NAME = "omb-discord";
const PROBE_TIMEOUT_MS = 1_500;

/** Project-scoped MCP bundles known to OMB. They are opt-in through
 * localMcp.servers so merely installing OMB never starts Ghidra or a binary
 * analysis process. */
export const PROJECT_MCP_CATALOG = [
  {
    name: "reva",
    displayName: "ReVa / Reverse Engineering Assistant",
    sourceUrl: "https://github.com/cyberkaida/reverse-engineering-assistant",
    recommendedProjectKinds: ["recomp", "mod"],
    transports: ["stdio", "streamable-http"],
    defaultAssistantUrl: "http://127.0.0.1:8080/mcp/message",
    setup: "Install the ReVa Ghidra extension (Ghidra 12+), then use assistant mode or configure the mcp-reva headless command.",
  },
  {
    name: "ghidramcp",
    displayName: "GhidraMCP",
    sourceUrl: "https://github.com/lauriewired/ghidramcp",
    recommendedProjectKinds: ["recomp", "mod"],
    transports: ["stdio", "sse"],
    defaultAssistantUrl: "http://127.0.0.1:8081/sse",
    setup: "Install the GhidraMCP extension and configure the Python bridge against the running Ghidra HTTP server.",
  },
] as const;

function candidateServers(cfg: AppConfig, options?: { projectKinds?: string[]; toolNames?: string[] }): McpServerEndpoint[] {
  const configured = cfg.localMcp?.servers ?? {};
  const merged: Record<string, {
    url?: string;
    enabled?: boolean;
    headers?: Record<string, string>;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    projectKinds?: string[];
  }> = {
    [DEFAULT_DISCORD_NAME]: { url: process.env.OPENMAUSBOT_DISCORD_MCP_URL || DEFAULT_DISCORD_URL },
    ...configured,
  };
  return Object.entries(merged)
    .filter(([name, server]) => {
      if (server.enabled === false) return false;
      if (options?.toolNames?.length && !options.toolNames.includes(name)) return false;
      if (options?.projectKinds?.length && server.projectKinds?.length && !server.projectKinds.some((kind) => options.projectKinds!.includes(kind))) {
        return false;
      }
      return Boolean((typeof server.url === "string" && server.url.trim()) || (typeof server.command === "string" && server.command.trim()));
    })
    .map(([name, server]) => ({
      name,
      ...(server.url?.trim() ? { url: server.url.trim() } : {}),
      ...(server.headers ? { headers: server.headers } : {}),
      ...(server.command?.trim() ? { command: server.command.trim(), args: server.args ?? [], env: server.env ?? {} } : {}),
      ...(server.projectKinds?.length ? { projectKinds: server.projectKinds } : {}),
    }));
}

async function reachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // HEAD is intentionally enough: a 405 still proves the MCP listener is
    // alive, while avoiding an initialize request and an orphaned MCP session.
    await fetch(url, { method: "HEAD", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Return only configured local MCP endpoints that are reachable right now. */
export async function discoverLocalMcp(cfg: AppConfig, options?: { projectKinds?: string[]; toolNames?: string[] }): Promise<McpServerEndpoint[]> {
  const candidates = candidateServers(cfg, options);
  const results = await Promise.all(
    candidates.map(async (server) => (server.command || (server.url && await reachable(server.url)) ? server : null)),
  );
  return results.filter((server): server is McpServerEndpoint => server !== null);
}

export const _internal = { candidateServers, reachable };
