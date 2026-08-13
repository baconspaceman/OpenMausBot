// Config + data dirs. One file, ~/.openmausbot/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "composio": {"key":"ck_…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { InstanceConfigMap } from "./contracts.ts";
import type { ComputerBackendSettings } from "./computer-backends.ts";

export interface AppConfig {
  xai?: { key?: string; url?: string };
  /** key = ck_… Connect consumer key (connections + agent tools);
   * apiKey = ak_… project API key — optional, unlocks the full toolkit
   * catalog with official logos in the plugins marketplace. */
  composio?: { key?: string; apiKey?: string; url?: string };
  box?: { token?: string };
  /** Optional local/remote shell backends. Key material stays on disk and is
   * referenced by path only; private key contents never enter app config. */
  computer?: ComputerBackendSettings;
  /** Host staging root for the provider-neutral File Bus. */
  fileBus?: { root?: string };
  /** Official Discord OAuth2 account connection. Tokens stay local and are
   * never passed into provider prompts or MCP process environments. */
  discordAccount?: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
    user?: { id: string; username?: string; globalName?: string };
  };
  /** Optional local MCP endpoints. The Discord bridge has a safe localhost default. */
  localMcp?: {
    servers?: Record<string, {
      url?: string;
      enabled?: boolean;
      headers?: Record<string, string>;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      projectKinds?: string[];
    }>;
  };
  instances?: InstanceConfigMap;
}

export const DATA_DIR = resolve(process.env.OPENMAUSBOT_DATA_DIR?.trim() || join(homedir(), ".openmausbot"));
const LEGACY_DATA_DIR = join(homedir(), ".opengrokbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");
/**
 * Private, local-only context shared with every provider turn. Keep this
 * outside the repository: it may contain personal workflow preferences and
 * project pointers, but must never contain provider credentials or tokens.
 * OPENMAUSBOT_AGENT_CONTEXT_FILE is useful for a supervised alternate path.
 */
export const AGENT_CONTEXT_FILE =
  process.env.OPENMAUSBOT_AGENT_CONTEXT_FILE?.trim() || join(DATA_DIR, "agent-context.md");
const MAX_AGENT_CONTEXT_CHARS = 24_000;

export function readAgentContext(file = AGENT_CONTEXT_FILE): string {
  try {
    const context = readFileSync(file, "utf8").trim();
    return context.length > MAX_AGENT_CONTEXT_CHARS
      ? `${context.slice(0, MAX_AGENT_CONTEXT_CHARS)}\n\n[Local context truncated at ${MAX_AGENT_CONTEXT_CHARS} characters.]`
      : context;
  } catch {
    return "";
  }
}

export function loadAgentContext(): string {
  return readAgentContext();
}

export function ensureDirs() {
  // one-time migration from the pre-rename data dir — bots, transcripts,
  // config and keys all carry over
  if (!existsSync(DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
    try {
      renameSync(LEGACY_DATA_DIR, DATA_DIR);
    } catch {
      /* cross-device or busy — fall through to a fresh dir */
    }
  }
  for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) mkdirSync(dir, { recursive: true });
}

export function loadConfig(): AppConfig {
  let cfg: AppConfig = {};
  try {
    cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
  } catch {
    /* first run — env fallbacks below */
  }
  cfg.xai = { key: process.env.XAI_API_KEY, ...cfg.xai };
  cfg.composio = { key: process.env.COMPOSIO_KEY, ...cfg.composio };
  cfg.box = { token: process.env.BOX_TOKEN, ...cfg.box };
  return cfg;
}

/** Merge a partial config into ~/.openmausbot/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
export function saveConfig(patch: Partial<AppConfig>): void {
  const p = join(DATA_DIR, "config.json");
  let disk: Record<string, unknown> = {};
  try {
    disk = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    /* first write */
  }
  for (const key of ["xai", "composio", "box", "computer", "fileBus", "discordAccount", "localMcp"] as const) {
    if (patch[key] && typeof patch[key] === "object") {
      disk[key] = { ...(disk[key] as object), ...patch[key] };
    }
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(p, JSON.stringify(disk, null, 2));
}

// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars.
export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // The default `grok` instance rides the `grokAgent` driver, not the API-key
  // one: like claude and codex it needs no credential from us, just the CLI
  // installed and logged in (it shows up unavailable otherwise). The API-key
  // `grok` driver stays registered but out of the default fleet — that key is
  // a credential Milind doesn't want to manage; an `instances` entry brings
  // it back anytime.
  const map: InstanceConfigMap =
    cfg.instances && Object.keys(cfg.instances).length
      ? cfg.instances
      : {
          grok: { driver: "grokAgent" },
          claude: { driver: "claudeAgent" },
          codex: { driver: "codex" },
          computer: { driver: "boxAgent" },
        };
  for (const entry of Object.values(map)) {
    entry.environment = {
      ...(cfg.xai?.key ? { XAI_API_KEY: cfg.xai.key } : {}),
      ...(cfg.box?.token ? { BOX_TOKEN: cfg.box.token } : {}),
      ...entry.environment,
    };
  }
  return map;
}
