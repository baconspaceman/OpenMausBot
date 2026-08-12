import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import type { AppConfig } from "./config.ts";

const execFileAsync = promisify(execFile);

export type ShellBackend = "wsl" | "hyperv" | "qemu" | "oracle";

export interface SshBackendConfig {
  host?: string;
  port?: number;
  user?: string;
  keyPath?: string;
}

export interface ComputerBackendSettings {
  wsl?: { distro?: string };
  hyperv?: { vmName?: string; ssh?: SshBackendConfig };
  qemu?: {
    imagePath?: string;
    qemuPath?: string;
    memoryMb?: number;
    ssh?: SshBackendConfig;
  };
  oracle?: SshBackendConfig;
}

export type BackendRuntimeConfig =
  | NonNullable<ComputerBackendSettings["wsl"]>
  | NonNullable<ComputerBackendSettings["hyperv"]>
  | NonNullable<ComputerBackendSettings["qemu"]>
  | NonNullable<ComputerBackendSettings["oracle"]>;

export interface BackendStatus {
  backend: ShellBackend;
  configured: boolean;
  ready: boolean;
  state: string;
  detail: string;
  desktopAvailable: false;
}

const qemuProcesses = new Map<string, ReturnType<typeof spawn>>();

export function isShellBackend(value: unknown): value is ShellBackend {
  return value === "wsl" || value === "hyperv" || value === "qemu" || value === "oracle";
}

export function backendLabel(backend: ShellBackend): string {
  return { wsl: "WSL2", hyperv: "Hyper-V", qemu: "QEMU", oracle: "Oracle SSH" }[backend];
}

export function backendConfig(cfg: AppConfig, backend: ShellBackend): BackendRuntimeConfig {
  return (cfg.computer?.[backend] ?? {}) as BackendRuntimeConfig;
}

function cleanOutput(value: string) {
  return value.replace(/\0/g, "").trim();
}

function psLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function command(name: string, args: string[], timeout = 10_000) {
  try {
    const result = await execFileAsync(name, args, { timeout, windowsHide: true, maxBuffer: 256 * 1024 });
    return { ok: true, stdout: cleanOutput(String(result.stdout ?? "")), stderr: cleanOutput(String(result.stderr ?? "")) };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: string | number; killed?: boolean; message?: string };
    return {
      ok: false,
      stdout: cleanOutput(String(e.stdout ?? "")),
      stderr: cleanOutput(String(e.stderr ?? e.message ?? "")),
      code: e.code,
      killed: e.killed,
    };
  }
}

function sshConfig(config: BackendRuntimeConfig): SshBackendConfig | null {
  const candidate = config as { ssh?: SshBackendConfig };
  if (candidate.ssh) return candidate.ssh;
  return config as SshBackendConfig;
}

function sshArgs(config: BackendRuntimeConfig, remoteCommand?: string) {
  const ssh = sshConfig(config);
  if (!ssh?.host || !ssh.user) throw new Error("SSH backend needs a host and user");
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new"];
  if (ssh.keyPath) args.push("-i", ssh.keyPath);
  if (ssh.port) args.push("-p", String(ssh.port));
  args.push(`${ssh.user}@${ssh.host}`);
  if (remoteCommand !== undefined) args.push("--", remoteCommand);
  return args;
}

export function buildWslArgs(config: BackendRuntimeConfig, remoteCommand: string) {
  const distro = (config as { distro?: string }).distro?.trim();
  return [...(distro ? ["--distribution", distro] : []), "--exec", "bash", "-lc", remoteCommand];
}

export function buildSshArgs(config: BackendRuntimeConfig, remoteCommand: string) {
  return sshArgs(config, remoteCommand);
}

export function buildScpArgs(config: BackendRuntimeConfig, source: string, destination: string) {
  const ssh = sshConfig(config);
  if (!ssh?.host || !ssh.user) throw new Error("SSH backend needs a host and user");
  const args = ["-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new"];
  if (ssh.keyPath) args.push("-i", ssh.keyPath);
  if (ssh.port) args.push("-P", String(ssh.port));
  args.push(source, destination);
  return args;
}

async function wslStatus(config: BackendRuntimeConfig): Promise<BackendStatus> {
  const listed = await command("wsl.exe", ["--list", "--quiet"]);
  if (!listed.ok) {
    return { backend: "wsl", configured: false, ready: false, state: "unavailable", detail: "WSL2 is not available", desktopAvailable: false };
  }
  const distro = (config as { distro?: string }).distro?.trim();
  const distros = listed.stdout.split(/\r?\n/).map((line) => line.replace(/^\*\s*/, "").trim()).filter(Boolean);
  if (!distros.length) {
    return { backend: "wsl", configured: false, ready: false, state: "not-installed", detail: "Install a WSL2 distribution first", desktopAvailable: false };
  }
  if (distro && !distros.some((name) => name.toLowerCase() === distro.toLowerCase())) {
    return { backend: "wsl", configured: false, ready: false, state: "missing-distro", detail: `WSL distribution '${distro}' was not found`, desktopAvailable: false };
  }
  return { backend: "wsl", configured: true, ready: true, state: "ready", detail: distro ? `Using ${distro}` : `Using ${distros[0]}`, desktopAvailable: false };
}

async function hypervStatus(config: BackendRuntimeConfig): Promise<BackendStatus> {
  const vmName = (config as { vmName?: string }).vmName?.trim();
  if (!vmName) return { backend: "hyperv", configured: false, ready: false, state: "unconfigured", detail: "Set a Hyper-V VM name", desktopAvailable: false };
  const ssh = sshConfig(config);
  if (!ssh?.host || !ssh.user || !ssh.keyPath) return { backend: "hyperv", configured: false, ready: false, state: "unconfigured", detail: "Set Hyper-V guest SSH host, user, and private-key path", desktopAvailable: false };
  const result = await command("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `try { (Get-VM -Name ${psLiteral(vmName)} -ErrorAction Stop).State } catch { exit 3 }`]);
  if (!result.ok) return { backend: "hyperv", configured: true, ready: false, state: "missing-vm", detail: `Hyper-V VM '${vmName}' was not found`, desktopAvailable: false };
  const state = result.stdout || "unknown";
  return { backend: "hyperv", configured: true, ready: state.toLowerCase() === "running", state: state.toLowerCase(), detail: `VM ${vmName} is ${state}`, desktopAvailable: false };
}

async function executableAvailable(file: string) {
  if (existsSync(file)) return true;
  return (await command("where.exe", [file], 5_000)).ok;
}

async function qemuStatus(config: BackendRuntimeConfig): Promise<BackendStatus> {
  const qemu = config as { imagePath?: string; qemuPath?: string; ssh?: SshBackendConfig };
  if (!qemu.imagePath) return { backend: "qemu", configured: false, ready: false, state: "unconfigured", detail: "Set a QEMU disk image path", desktopAvailable: false };
  if (!existsSync(qemu.imagePath)) return { backend: "qemu", configured: true, ready: false, state: "missing-image", detail: "The configured QEMU image does not exist", desktopAvailable: false };
  const qemuPath = qemu.qemuPath || "qemu-system-x86_64.exe";
  if (!(await executableAvailable(qemuPath))) return { backend: "qemu", configured: true, ready: false, state: "missing-qemu", detail: "qemu-system-x86_64.exe was not found", desktopAvailable: false };
  const running = Boolean(qemuProcesses.get(qemu.imagePath)?.exitCode === null && !qemuProcesses.get(qemu.imagePath)?.killed);
  return { backend: "qemu", configured: true, ready: running, state: running ? "running" : "stopped", detail: running ? "QEMU is running" : "QEMU is ready to start", desktopAvailable: false };
}

async function oracleStatus(config: BackendRuntimeConfig): Promise<BackendStatus> {
  const ssh = config as SshBackendConfig;
  if (!ssh.host || !ssh.user || !ssh.keyPath) {
    return { backend: "oracle", configured: false, ready: false, state: "unconfigured", detail: "Set Oracle host, user, and private-key path", desktopAvailable: false };
  }
  if (!existsSync(ssh.keyPath)) return { backend: "oracle", configured: true, ready: false, state: "missing-key", detail: "The configured SSH private key does not exist", desktopAvailable: false };
  return { backend: "oracle", configured: true, ready: true, state: "ready", detail: `${ssh.user}@${ssh.host} is configured`, desktopAvailable: false };
}

export async function backendStatus(cfg: AppConfig, backend: ShellBackend): Promise<BackendStatus> {
  const config = backendConfig(cfg, backend);
  if (backend === "wsl") return wslStatus(config);
  if (backend === "hyperv") return hypervStatus(config);
  if (backend === "qemu") return qemuStatus(config);
  return oracleStatus(config);
}

export async function runBackendCommand(backend: ShellBackend, config: BackendRuntimeConfig, remoteCommand: string, timeout = 120_000) {
  const commandText = String(remoteCommand ?? "").trim().slice(0, 4_000);
  if (!commandText) throw new Error("command required");
  const result = backend === "wsl"
    ? await command("wsl.exe", buildWslArgs(config, commandText), timeout)
    : await command("ssh.exe", buildSshArgs(config, commandText), timeout);
  return { ok: result.ok, exitCode: result.ok ? 0 : typeof result.code === "number" ? result.code : 1, stdout: result.stdout, stderr: result.stderr };
}

export async function provisionBackend(cfg: AppConfig, backend: ShellBackend) {
  if (backend === "wsl") {
    const status = await backendStatus(cfg, backend);
    if (!status.ready) throw new Error(status.detail);
    return status;
  }
  if (backend === "hyperv") {
    const status = await hypervStatus(backendConfig(cfg, backend));
    if (!status.configured || status.state === "missing-vm") throw new Error(status.detail);
    if (!status.ready) {
      const vmName = (backendConfig(cfg, backend) as { vmName?: string }).vmName!;
      const started = await command("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `Start-VM -Name ${psLiteral(vmName)} -ErrorAction Stop`], 30_000);
      if (!started.ok) throw new Error(started.stderr || `could not start Hyper-V VM '${vmName}'`);
    }
    return hypervStatus(backendConfig(cfg, backend));
  }
  if (backend === "qemu") {
    const status = await qemuStatus(backendConfig(cfg, backend));
    if (!status.configured || status.state === "missing-image" || status.state === "missing-qemu") throw new Error(status.detail);
    const config = backendConfig(cfg, backend) as { imagePath: string; qemuPath?: string; memoryMb?: number; ssh?: SshBackendConfig };
    if (!config.ssh?.user || !config.ssh.keyPath) throw new Error("QEMU needs SSH user and private-key path for agent control");
    const existing = qemuProcesses.get(config.imagePath);
    if (existing && existing.exitCode === null && !existing.killed) return status;
    const qemuPath = config.qemuPath || "qemu-system-x86_64.exe";
    const sshPort = config.ssh.port ?? 2222;
    const args = ["-display", "none", "-m", String(config.memoryMb ?? 4096), "-drive", `file=${config.imagePath},if=virtio`, "-nic", `user,model=virtio,hostfwd=tcp::${sshPort}-:22`];
    const child = spawn(qemuPath, args, { detached: true, stdio: "ignore", windowsHide: true });
    if (!child.pid) throw new Error("QEMU did not start");
    qemuProcesses.set(config.imagePath, child);
    child.once("exit", () => qemuProcesses.delete(config.imagePath));
    child.unref();
    return { ...status, ready: true, state: "running", detail: `QEMU started with PID ${child.pid}` };
  }
  const config = backendConfig(cfg, backend);
  const probe = await runBackendCommand(backend, config, "printf openmausbot-ssh-ok", 20_000);
  if (!probe.ok) throw new Error(probe.stderr || "Oracle SSH connection failed");
  return { ...(await oracleStatus(config)), ready: true, state: "connected", detail: "Oracle SSH connection succeeded" };
}

export async function sleepBackend(cfg: AppConfig, backend: ShellBackend) {
  if (backend === "wsl" || backend === "oracle") return { ok: true, state: "ready" };
  if (backend === "hyperv") {
    const vmName = (backendConfig(cfg, backend) as { vmName?: string }).vmName;
    if (!vmName) throw new Error("Set a Hyper-V VM name first");
    const result = await command("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `Stop-VM -Name ${psLiteral(vmName)} -Force -ErrorAction Stop`], 30_000);
    if (!result.ok) throw new Error(result.stderr || "could not stop Hyper-V VM");
    return { ok: true, state: "off" };
  }
  const imagePath = (backendConfig(cfg, backend) as { imagePath?: string }).imagePath;
  const child = imagePath ? qemuProcesses.get(imagePath) : undefined;
  if (child) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
    if (imagePath) qemuProcesses.delete(imagePath);
  }
  return { ok: true, state: "stopped" };
}

export function backendConfigStatus(cfg: AppConfig) {
  const settings = cfg.computer ?? {};
  const sshStatus = (ssh?: SshBackendConfig) =>
    ssh ? { host: ssh.host ?? "", port: ssh.port ?? 22, user: ssh.user ?? "", keyPath: ssh.keyPath ?? "" } : undefined;
  return {
    wsl: { configured: Boolean(settings.wsl?.distro), distro: settings.wsl?.distro ?? "" },
    hyperv: { configured: Boolean(settings.hyperv?.vmName), vmName: settings.hyperv?.vmName ?? "", ssh: sshStatus(settings.hyperv?.ssh) },
    qemu: { configured: Boolean(settings.qemu?.imagePath), imagePath: settings.qemu?.imagePath ?? "", qemuPath: settings.qemu?.qemuPath ?? "", memoryMb: settings.qemu?.memoryMb ?? 4096, ssh: sshStatus(settings.qemu?.ssh) },
    oracle: { configured: Boolean(settings.oracle?.host && settings.oracle?.user && settings.oracle?.keyPath), host: settings.oracle?.host ?? "", user: settings.oracle?.user ?? "", port: settings.oracle?.port ?? 22, keyPath: settings.oracle?.keyPath ?? "" },
  };
}
