# OMB Project Workbench

OpenMausBot now has a provider-neutral project layer for long-running work such as Archipelago worlds, native recomps, game mods, and research projects.

The durable relationship is:

```text
Project
  └─ specialist lane assignment
       └─ OMB bot → provider/model → conversation thread
```

Projects, assignments, and work items are stored locally under `~/.openmausbot`:

- `projects.json` — project identity, kind, root path, repository, lanes, and enabled project MCP bundles
- `project-assignments.json` — which bot owns which lane
- `project-work-items.json` — bugs, QA checks, research, Discord conversations, tasks, and releases

The React UI is only a projection. A future GUI can use the HTTP API and SSE stream without depending on the current sidebar/reducer structure.

## Project kinds and default lanes

`archipelago-world` creates world development, QA, bug triage, Discord research, GitHub research, and docs/release lanes.

`recomp` and `mod` create engineering, QA, bug triage, Discord research, and docs/release lanes. They also opt into the `reva` and `ghidramcp` project MCP bundle names. The bundles are not started until their MCP endpoints are configured and reachable.

Every work item can carry evidence references such as:

```json
{
  "kind": "discord-thread",
  "ref": "https://discord.com/channels/<guild>/<thread>",
  "label": "Community regression report"
}
```

Supported evidence kinds are `discord-thread`, `discord-message`, `github`, `file`, `url`, and `test`.

## API surface

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `GET /api/projects/context?bot_id=:botId`
- `GET /api/projects/:id/assignments`
- `POST /api/projects/:id/assignments`
- `PATCH /api/project-assignments/:assignmentId`
- `GET /api/projects/:id/work-items`
- `POST /api/projects/:id/work-items`
- `PATCH /api/project-work-items/:workItemId`
- `GET /api/project-tools/catalog`

The project MCP tools exposed to an assigned agent are `project_get_context`, `project_list_work_items`, `project_create_work_item`, and `project_update_work_item`. Agents are instructed to record work only when the owner asks them to track it.

## ReVa and GhidraMCP integration

OMB treats both reverse-engineering MCPs as optional project-scoped tool bundles:

- [ReVa / Reverse Engineering Assistant](https://github.com/cyberkaida/reverse-engineering-assistant) — a Ghidra extension with assistant and headless modes. OMB supports its streamable HTTP endpoint and stdio command form.
- [GhidraMCP](https://github.com/lauriewired/ghidramcp) — a Ghidra extension plus Python bridge. OMB supports its SSE/HTTP endpoint and stdio bridge form.

Both are local analysis tools. Keep the servers on loopback, do not expose them to the LAN, and do not enable script-capable analysis against untrusted binaries without supervision. ReVa's upstream documentation says it requires Ghidra 12 or newer and warns that exposing its scripting environment publicly requires authentication or disabling scripting tools. GhidraMCP requires Ghidra, Python, and its installed extension/bridge.

Configure the endpoints through `PUT /api/config` or a future settings panel. Example for ReVa assistant mode plus the GhidraMCP Python bridge:

```json
{
  "localMcp": {
    "servers": {
      "reva": {
        "enabled": true,
        "url": "http://127.0.0.1:8080/mcp/message",
        "projectKinds": ["recomp", "mod"]
      },
      "ghidramcp": {
        "enabled": true,
        "command": "C:\\Path\\to\\python.exe",
        "args": [
          "C:\\Path\\to\\bridge_mcp_ghidra.py",
          "--ghidra-server",
          "http://127.0.0.1:8080/"
        ],
        "projectKinds": ["recomp", "mod"]
      }
    }
  }
}
```

For ReVa headless mode, replace its `url` with a stdio entry such as:

```json
{
  "command": "mcp-reva",
  "args": [],
  "env": {
    "GHIDRA_INSTALL_DIR": "C:\\Path\\to\\ghidra"
  }
}
```

The provider drivers translate these entries to their native MCP configuration. That keeps Claude, Codex, and ACP/Grok-compatible routes aligned while the project workbench remains independent of any one model or GUI.

## Recommended AP operating pattern

Create one project per AP world. Assign separate bots to world development, QA, bug triage, Discord research, and release/docs. Link each report to the Discord thread or message, GitHub issue/PR, test command, or file that supports it. Keep “observed,” “reproduced,” “fixed,” and “verified” as separate work-item states or notes; never collapse them into a single claim.
