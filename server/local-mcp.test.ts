import { describe, expect, it } from "vitest";

import { _internal } from "./local-mcp.ts";

describe("project-scoped local MCP discovery", () => {
  it("keeps global MCPs and selects configured reverse-engineering bundles by project kind", () => {
    const servers = _internal.candidateServers(
      {
        localMcp: {
          servers: {
            reva: { command: "mcp-reva", projectKinds: ["recomp", "mod"] },
            ghidramcp: { url: "http://127.0.0.1:8081/sse", projectKinds: ["recomp", "mod"] },
            discord: { url: "http://127.0.0.1:8766/mcp" },
          },
        },
      },
      { projectKinds: ["recomp"] },
    );

    expect(servers.map((server) => server.name)).toEqual(expect.arrayContaining(["reva", "ghidramcp", "discord"]));
    expect(servers.find((server) => server.name === "reva")).toMatchObject({ command: "mcp-reva", args: [], env: {} });
  });

  it("does not attach a project-only MCP to an unrelated project kind", () => {
    const servers = _internal.candidateServers(
      { localMcp: { servers: { reva: { command: "mcp-reva", projectKinds: ["recomp"] } } } },
      { projectKinds: ["archipelago-world"] },
    );
    expect(servers.some((server) => server.name === "reva")).toBe(false);
  });
});
