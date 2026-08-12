import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { AppConfig } from "./config.ts";
import { DATA_DIR } from "./config.ts";
import { backendConfig, buildScpArgs, buildWslArgs, type BackendRuntimeConfig, type ShellBackend } from "./computer-backends.ts";

const execFileAsync = promisify(execFile);
export type FileBusBackend = "host" | ShellBackend | "box";

export interface FileLocation {
  backend: FileBusBackend;
  path: string;
}

function root(cfg: AppConfig) {
  return resolve(cfg.fileBus?.root?.trim() || join(DATA_DIR, "file-bus"));
}

export function fileBusRoot(cfg: AppConfig) {
  return root(cfg);
}

async function ensureRoot(cfg: AppConfig) {
  const dir = root(cfg);
  await mkdir(dir, { recursive: true });
  return dir;
}

function hostPath(cfg: AppConfig, value: string) {
  const base = root(cfg);
  if (!value.trim() || isAbsolute(value)) throw new Error("host file paths must be relative to the File Bus root");
  const file = resolve(base, value);
  const rel = relative(base, file);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("host file path escapes the File Bus root");
  }
  return file;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function wslPathForWindows(value: string) {
  const match = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) throw new Error("WSL file transfer currently needs a local Windows drive path");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

async function run(name: string, args: string[], timeout = 300_000) {
  try {
    await execFileAsync(name, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    throw new Error(String(e.stderr ?? e.message ?? `${name} failed`).trim().slice(-1000));
  }
}

function remoteSpec(config: Record<string, unknown>, remotePath: string) {
  const ssh = (config.ssh ?? config) as { host?: string; user?: string };
  if (!ssh.host || !ssh.user) throw new Error("SSH file transfer needs a host and user");
  return `${ssh.user}@${ssh.host}:${remotePath}`;
}

async function copyWsl(config: Record<string, unknown>, source: string, destination: string) {
  await run(
    "wsl.exe",
    buildWslArgs(
      config as BackendRuntimeConfig,
      `mkdir -p ${shellQuote(dirname(destination))}; cp -f -- ${shellQuote(source)} ${shellQuote(destination)}`,
    ),
  );
}

async function copyFromGuest(cfg: AppConfig, location: FileLocation, destination: string) {
  if (location.backend === "wsl") {
    await copyWsl(backendConfig(cfg, "wsl") as Record<string, unknown>, location.path, wslPathForWindows(destination));
    return;
  }
  if (location.backend === "box") throw new Error("Box file transfer adapter is reserved for the cloud-file implementation");
  if (location.backend === "host") throw new Error("host is handled by the File Bus staging layer");
  const config = backendConfig(cfg, location.backend) as Record<string, unknown>;
  await run("scp.exe", buildScpArgs(config as BackendRuntimeConfig, remoteSpec(config, location.path), destination));
}

async function copyToGuest(cfg: AppConfig, source: string, location: FileLocation) {
  if (location.backend === "wsl") {
    await copyWsl(backendConfig(cfg, "wsl") as Record<string, unknown>, wslPathForWindows(source), location.path);
    return;
  }
  if (location.backend === "box") throw new Error("Box file transfer adapter is reserved for the cloud-file implementation");
  if (location.backend === "host") throw new Error("host is handled by the File Bus staging layer");
  const config = backendConfig(cfg, location.backend) as Record<string, unknown>;
  await run("scp.exe", buildScpArgs(config as BackendRuntimeConfig, source, remoteSpec(config, location.path)));
}

export async function transferFile(cfg: AppConfig, source: FileLocation, destination: FileLocation) {
  if (source.backend === "box" || destination.backend === "box") {
    throw new Error("Box file transfer is not enabled in this first File Bus adapter; shell and host backends are supported");
  }
  const base = await ensureRoot(cfg);
  const tempDir = join(base, ".tmp");
  await mkdir(tempDir, { recursive: true });
  const temp = join(tempDir, `${Date.now()}-${Math.random().toString(16).slice(2)}-${basename(source.path) || "transfer"}`);
  try {
    if (source.backend === "host") await copyFile(hostPath(cfg, source.path), temp);
    else await copyFromGuest(cfg, source, temp);

    if (destination.backend === "host") {
      const target = hostPath(cfg, destination.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(temp, target);
    } else await copyToGuest(cfg, temp, destination);

    return { ok: true, source, destination, bytes: (await stat(temp)).size };
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

export async function listFileBus(cfg: AppConfig) {
  const dir = await ensureRoot(cfg);
  const entries = await readdir(dir, { withFileTypes: true });
  return {
    root: dir,
    files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  };
}

export function fileBusStatus(cfg: AppConfig) {
  const configuredRoot = cfg.fileBus?.root?.trim() || join(DATA_DIR, "file-bus");
  return { configured: Boolean(cfg.fileBus?.root), root: configuredRoot, exists: existsSync(configuredRoot) };
}
