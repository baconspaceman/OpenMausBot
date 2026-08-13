# Bacon Station design and room protocol

Bacon Station is the working product name for the next OMB phase. It is a desktop-first creator workspace for Archipelago worlds, recomps, mods, QA, Discord research, evidence, and local computing rooms. The product name can change later without changing the provider, bot, project, or MCP contracts.

## Visual direction

- Main workspace: a blend of channel-style project navigation and engineering workbench panels.
- Palette: soot black, dark iron, ember red, oxidized copper, warm brass, and restrained teal status accents.
- VM mode: a separate room surface with a large machine preview, roster/status, files/notes, and a text box for agent help.
- Presence tiles are visual agent status only. Bacon Station does not claim webcam, microphone, calling, or voice support.
- The existing provider, plugin, Discord, and computer settings remain available through the shell while the new workspace becomes the default surface.

## Agent-room contract

Rooms are the coordination boundary between a human, persistent agents, temporary specialists, and a VM session.

Persistent participants are selected from existing OMB bots and remain available to future rooms. A temporary participant is created for one narrow request, is marked `temporary`, receives a focused instruction and evidence scope, and is released when the task completes or the owner removes it. Release must delete the temporary participant's room membership and ephemeral context; it must not create a new persistent bot or appear in the bot catalog.

Room messages are typed events rather than provider-specific chat bubbles:

```ts
type RoomEvent =
  | { type: "message"; roomId: string; from: "human" | "agent"; fromBotId?: string; text: string; evidenceIds?: string[] }
  | { type: "agent.call"; roomId: string; fromBotId: string; toBotId?: string; role: string; task: string; temporary: boolean }
  | { type: "agent.join"; roomId: string; botId: string; temporary: boolean }
  | { type: "agent.leave"; roomId: string; botId: string; reason: "completed" | "released" | "cancelled" }
  | { type: "vm.status"; roomId: string; state: "ready" | "running" | "stopped" | "error"; backend: string };
```

The UI already exposes the important states: persistent versus temporary, called in for a narrow task, leaving when complete, and text-only VM assistance. The next runtime slice should move the current local room state into a server-backed room store, then route `agent.call` events into bounded bot turns with explicit evidence and permission gates.

## Rename-safe boundaries

Keep the future product name out of API paths, persisted provider identifiers, and MCP names. Use product branding only in the client shell, labels, and documentation. This preserves compatibility with the existing OpenMausBot fork while allowing a later executable and package rename.
