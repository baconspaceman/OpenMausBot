// Minimal official Discord RPC-over-IPC client for Windows.
//
// This is intentionally read-only: it authenticates the local Discord client
// with an OAuth2 access token and uses GET_GUILDS, GET_CHANNELS, and
// GET_CHANNEL. It does not select channels, send messages, or change presence.
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";

import type { AppConfig } from "./config.ts";

const RPC_PIPE_PREFIX = "\\\\?\\pipe\\discord-ipc-";
const HANDSHAKE = 0;
const FRAME = 1;
const CLOSE = 2;
const PIPE_CONNECT_TIMEOUT_MS = 1_500;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;
const OPERATION_TIMEOUT_MS = 12_000;
const MAX_PIPE_INDEX = 4;

export class DiscordRpcError extends Error {
  readonly status = 403;
}

interface RpcPayload {
  cmd?: string;
  evt?: string | null;
  nonce?: string | null;
  data?: any;
}

class DiscordRpcClient {
  private readonly clientId: string;
  private readonly accessToken: string;
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  constructor(clientId: string, accessToken: string) {
    this.clientId = clientId;
    this.accessToken = accessToken;
  }

  private send(opcode: number, payload: Record<string, unknown>) {
    if (!this.socket) throw new DiscordRpcError("Discord desktop RPC is not connected.");
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(8);
    header.writeInt32LE(opcode, 0);
    header.writeInt32LE(body.length, 4);
    this.socket.write(Buffer.concat([header, body]));
  }

  private fail(error: Error) {
    this.readyReject?.(error);
    this.readyReject = null;
    this.readyResolve = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private onPayload(payload: RpcPayload) {
    if (payload.evt === "READY") {
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    if (payload.evt === "ERROR") {
      const error = new DiscordRpcError(
        typeof payload.data?.message === "string"
          ? `Discord RPC error: ${payload.data.message}`
          : `Discord RPC error${payload.data?.code ? ` (${payload.data.code})` : ""}`,
      );
      if (payload.nonce && this.pending.has(payload.nonce)) {
        const entry = this.pending.get(payload.nonce)!;
        this.pending.delete(payload.nonce);
        clearTimeout(entry.timer);
        entry.reject(error);
      } else {
        this.fail(error);
      }
      return;
    }
    if (payload.nonce && this.pending.has(payload.nonce)) {
      const entry = this.pending.get(payload.nonce)!;
      this.pending.delete(payload.nonce);
      clearTimeout(entry.timer);
      entry.resolve(payload.data ?? {});
    }
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > 10_000_000) {
        this.fail(new DiscordRpcError("Discord RPC returned an invalid frame."));
        return;
      }
      if (this.buffer.length < 8 + length) return;
      const body = this.buffer.subarray(8, 8 + length).toString("utf8");
      this.buffer = this.buffer.subarray(8 + length);
      if (opcode === CLOSE) {
        this.fail(new DiscordRpcError("Discord closed the local RPC connection."));
        return;
      }
      try {
        this.onPayload(JSON.parse(body) as RpcPayload);
      } catch {
        this.fail(new DiscordRpcError("Discord RPC returned invalid JSON."));
        return;
      }
    }
  }

  private openPipe(index: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(`${RPC_PIPE_PREFIX}${index}`);
      const cleanup = () => {
        socket.off("error", onError);
        socket.off("connect", onConnect);
        socket.off("timeout", onTimeout);
      };
      const onError = (error: Error) => {
        cleanup();
        socket.destroy();
        reject(error);
      };
      const onTimeout = () => onError(new DiscordRpcError(`Discord RPC pipe ${index} did not connect in time.`));
      const onConnect = () => {
        cleanup();
        socket.setTimeout(0);
        resolve(socket);
      };
      socket.once("error", onError);
      socket.once("connect", onConnect);
      socket.setTimeout(PIPE_CONNECT_TIMEOUT_MS, onTimeout);
    });
  }

  async connect() {
    let lastError: unknown;
    for (let index = 0; index < MAX_PIPE_INDEX; index += 1) {
      try {
        this.socket = await this.openPipe(index);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!this.socket) {
      throw new DiscordRpcError(
        "Discord desktop is not available for local RPC. Open Discord, then enable the RPC research connection in OMB." +
          (lastError instanceof Error ? ` (${lastError.message})` : ""),
      );
    }
    this.socket.on("data", (chunk) => this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    this.socket.on("error", (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.socket.on("close", () => this.fail(new DiscordRpcError("Discord desktop closed local RPC.")));

    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const handshakeTimer = setTimeout(() => {
      this.readyReject?.(new DiscordRpcError("Discord RPC handshake timed out."));
    }, HANDSHAKE_TIMEOUT_MS);
    try {
      this.send(HANDSHAKE, { v: 1, client_id: this.clientId });
      await ready;
    } finally {
      clearTimeout(handshakeTimer);
      this.readyResolve = null;
      this.readyReject = null;
    }
    await this.request("AUTHENTICATE", { access_token: this.accessToken });
  }

  request(cmd: string, args: Record<string, unknown>) {
    const nonce = randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new DiscordRpcError(`Discord RPC timed out while running ${cmd}.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(nonce, { resolve, reject, timer });
      try {
        this.send(FRAME, { cmd, args, nonce });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(nonce);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close() {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
    this.socket?.destroy();
    this.socket = null;
  }
}

function rpcCredentials(cfg: AppConfig) {
  const current = cfg.discordAccount ?? {};
  const scopes = (current.scope || "").split(/\s+/).filter(Boolean);
  if (!current.clientId || !current.accessToken || !scopes.includes("rpc") || !scopes.includes("messages.read")) {
    throw new DiscordRpcError(
      "Discord channel and thread research is not enabled. Reconnect OMB with the local RPC + messages.read scopes first.",
    );
  }
  return { clientId: current.clientId, accessToken: current.accessToken };
}

async function withRpc<T>(cfg: AppConfig, fn: (client: DiscordRpcClient) => Promise<T>): Promise<T> {
  const credentials = rpcCredentials(cfg);
  const client = new DiscordRpcClient(credentials.clientId, credentials.accessToken);
  let operationTimer: NodeJS.Timeout | undefined;
  try {
    const operation = (async () => {
      await client.connect();
      return fn(client);
    })();
    const timeout = new Promise<never>((_, reject) => {
      operationTimer = setTimeout(
        () => reject(new DiscordRpcError("Discord local RPC did not respond in time; do not retry this lookup in the same turn.")),
        OPERATION_TIMEOUT_MS,
      );
    });
    return await Promise.race([operation, timeout]);
  } finally {
    if (operationTimer) clearTimeout(operationTimer);
    client.close();
  }
}

export async function rpcListGuilds(cfg: AppConfig) {
  return withRpc(cfg, async (client) => (await client.request("GET_GUILDS", {})).guilds ?? []);
}

export async function rpcListChannels(cfg: AppConfig, guildId: string) {
  return withRpc(cfg, async (client) => (await client.request("GET_CHANNELS", { guild_id: guildId })).channels ?? []);
}

export async function rpcGetChannel(cfg: AppConfig, channelId: string) {
  return withRpc(cfg, async (client) => client.request("GET_CHANNEL", { channel_id: channelId }));
}

export const _internal = { rpcCredentials };
