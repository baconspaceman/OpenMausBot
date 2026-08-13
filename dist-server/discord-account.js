// Official Discord OAuth2 account research connection.
// This is deliberately separate from the bot-token Discord MCP bridge:
// OAuth2 acts on behalf of Anthony's account, while the research surface
// exposed to agents is read-only. Account tokens never enter prompts or
// child-process environments.
import { randomBytes } from "node:crypto";
const API_BASE = "https://discord.com/api/v10";
const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const DEFAULT_SCOPE = "identify guilds";
const STATE_TTL_MS = 10 * 60_000;
export class DiscordAccountError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.name = "DiscordAccountError";
    }
}
let pendingOAuth = null;
function account(cfg) {
    return cfg.discordAccount ?? {};
}
export function defaultDiscordRedirectUri(port = 8799) {
    return `http://127.0.0.1:${port}/api/discord-account/oauth/callback`;
}
export function discordAccountStatus(cfg, port = 8799) {
    const current = account(cfg);
    return {
        configured: Boolean(current.clientId && current.clientSecret),
        connected: Boolean(current.accessToken || current.refreshToken),
        clientIdConfigured: Boolean(current.clientId),
        redirectUri: current.redirectUri || defaultDiscordRedirectUri(port),
        scopes: (current.scope || DEFAULT_SCOPE).split(/\s+/).filter(Boolean),
        expiresAt: typeof current.expiresAt === "number" ? current.expiresAt : null,
        user: current.user ?? null,
    };
}
function requireConfig(cfg) {
    const current = account(cfg);
    if (!current.clientId || !current.clientSecret) {
        throw new DiscordAccountError("Discord Account Research needs an OAuth2 Client ID and Client Secret first.");
    }
    return current;
}
function redirectUri(cfg, port) {
    return account(cfg).redirectUri?.trim() || defaultDiscordRedirectUri(port);
}
function validateRedirectUri(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new DiscordAccountError("Discord redirect URI must be a valid http:// or https:// URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new DiscordAccountError("Discord redirect URI must use http:// or https://.");
    }
}
export function startDiscordOAuth(cfg, port = 8799) {
    const current = requireConfig(cfg);
    const callback = redirectUri(cfg, port);
    validateRedirectUri(callback);
    const state = randomBytes(24).toString("hex");
    pendingOAuth = { state, redirectUri: callback, createdAt: Date.now() };
    const params = new URLSearchParams({
        client_id: current.clientId,
        response_type: "code",
        redirect_uri: callback,
        scope: current.scope || DEFAULT_SCOPE,
        state,
    });
    return { authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`, redirectUri: callback };
}
async function readJson(res) {
    return res.json().catch(() => ({}));
}
async function tokenExchange(body) {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(30_000),
    });
    const data = await readJson(res);
    if (!res.ok || typeof data.access_token !== "string") {
        throw new DiscordAccountError(`Discord OAuth token exchange failed (${res.status}).`, res.status || 502);
    }
    return data;
}
export async function completeDiscordOAuth(cfg, code, state, port = 8799) {
    const pending = pendingOAuth;
    pendingOAuth = null;
    if (!pending || pending.state !== state || Date.now() - pending.createdAt > STATE_TTL_MS) {
        throw new DiscordAccountError("Discord OAuth state expired or did not match this OMB session.", 403);
    }
    if (!code.trim())
        throw new DiscordAccountError("Discord did not return an authorization code.");
    const current = requireConfig(cfg);
    const callback = redirectUri(cfg, port);
    if (callback !== pending.redirectUri)
        throw new DiscordAccountError("Discord redirect URI changed during sign-in.", 403);
    const token = await tokenExchange(new URLSearchParams({
        client_id: current.clientId,
        client_secret: current.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: callback,
    }));
    const user = await fetchDiscord(cfg, "/users/@me", undefined, {
        accessToken: token.access_token,
        expiresAt: Date.now() + Number(token.expires_in ?? 604_800) * 1000,
    });
    return {
        discordAccount: {
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date.now() + Number(token.expires_in ?? 604_800) * 1000,
            scope: token.scope || current.scope || DEFAULT_SCOPE,
            user: {
                id: String(user.id),
                username: typeof user.username === "string" ? user.username : undefined,
                globalName: typeof user.global_name === "string" ? user.global_name : undefined,
            },
        },
    };
}
async function refreshAccessToken(cfg, writer) {
    const current = account(cfg);
    if (!current.refreshToken || !current.clientId || !current.clientSecret) {
        throw new DiscordAccountError("Discord Account Research is not connected. Connect it from Plugins.", 401);
    }
    const token = await tokenExchange(new URLSearchParams({
        client_id: current.clientId,
        client_secret: current.clientSecret,
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
    }));
    const patch = {
        discordAccount: {
            accessToken: token.access_token,
            refreshToken: token.refresh_token || current.refreshToken,
            expiresAt: Date.now() + Number(token.expires_in ?? 604_800) * 1000,
            scope: token.scope || current.scope || DEFAULT_SCOPE,
        },
    };
    writer?.(patch);
    Object.assign(cfg.discordAccount ?? (cfg.discordAccount = {}), patch.discordAccount);
    return token.access_token;
}
async function accessToken(cfg, writer, forceRefresh = false) {
    const current = account(cfg);
    if (!forceRefresh && current.accessToken && (!current.expiresAt || current.expiresAt > Date.now() + 60_000)) {
        return current.accessToken;
    }
    return refreshAccessToken(cfg, writer);
}
async function fetchDiscord(cfg, path, init, override, writer) {
    const token = override?.accessToken || (await accessToken(cfg, writer));
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        signal: init?.signal ?? AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && !override) {
        const refreshed = await accessToken(cfg, writer, true);
        const retry = await fetch(`${API_BASE}${path}`, {
            ...init,
            headers: { authorization: `Bearer ${refreshed}`, ...(init?.headers ?? {}) },
            signal: init?.signal ?? AbortSignal.timeout(30_000),
        });
        const retryData = await readJson(retry);
        if (!retry.ok)
            throw new DiscordAccountError(`Discord API request failed (${retry.status}).`, retry.status);
        return retryData;
    }
    const data = await readJson(res);
    if (!res.ok) {
        const detail = typeof data?.message === "string" ? `: ${data.message}` : "";
        throw new DiscordAccountError(`Discord API request failed (${res.status})${detail}`, res.status);
    }
    return data;
}
export async function listDiscordGuilds(cfg, writer) {
    const rows = await fetchDiscord(cfg, "/users/@me/guilds", undefined, undefined, writer);
    if (!Array.isArray(rows))
        return [];
    return rows.map((guild) => ({
        id: String(guild.id),
        name: String(guild.name ?? "Unnamed server"),
        icon: typeof guild.icon === "string" ? guild.icon : null,
        owner: Boolean(guild.owner),
        permissions: typeof guild.permissions === "string" ? guild.permissions : null,
        features: Array.isArray(guild.features) ? guild.features.slice(0, 30) : [],
    }));
}
export async function listDiscordChannels(cfg, guildId, writer) {
    const rows = await fetchDiscord(cfg, `/guilds/${encodeURIComponent(guildId)}/channels`, undefined, undefined, writer);
    if (!Array.isArray(rows))
        return [];
    return rows.map((channel) => ({
        id: String(channel.id),
        guildId: String(channel.guild_id ?? guildId),
        name: String(channel.name ?? "Unnamed channel"),
        type: Number(channel.type),
        parentId: channel.parent_id ? String(channel.parent_id) : null,
        position: typeof channel.position === "number" ? channel.position : 0,
        readable: true,
    }));
}
function messageQuery(params) {
    const limit = Math.min(Math.max(Number(params.get("limit") || 25), 1), 100);
    const query = new URLSearchParams({ limit: String(limit) });
    for (const key of ["before", "after", "around"]) {
        const value = params.get(key);
        if (value)
            query.set(key, value);
    }
    return query;
}
function mapMessages(rows) {
    return rows.slice(0, 100).map((message) => ({
        id: String(message.id),
        channelId: message.channel_id ? String(message.channel_id) : null,
        author: message.author
            ? {
                id: String(message.author.id),
                username: String(message.author.username ?? "unknown"),
                globalName: typeof message.author.global_name === "string" ? message.author.global_name : null,
                bot: Boolean(message.author.bot),
            }
            : null,
        content: String(message.content ?? ""),
        timestamp: message.timestamp ?? null,
        editedTimestamp: message.edited_timestamp ?? null,
        attachments: Array.isArray(message.attachments)
            ? message.attachments.slice(0, 10).map((attachment) => ({
                id: String(attachment.id),
                filename: String(attachment.filename ?? "file"),
                size: typeof attachment.size === "number" ? attachment.size : null,
            }))
            : [],
    }));
}
export async function listDiscordMessages(cfg, channelId, params, writer) {
    const rows = await fetchDiscord(cfg, `/channels/${encodeURIComponent(channelId)}/messages?${messageQuery(params).toString()}`, undefined, undefined, writer);
    return Array.isArray(rows) ? mapMessages(rows) : [];
}
export async function searchDiscordGuild(cfg, guildId, params, writer) {
    const content = (params.get("content") || "").trim();
    if (!content)
        throw new DiscordAccountError("A search phrase is required.");
    const query = new URLSearchParams({ content, limit: String(Math.min(Math.max(Number(params.get("limit") || 25), 1), 25)) });
    const data = await fetchDiscord(cfg, `/guilds/${encodeURIComponent(guildId)}/messages/search?${query.toString()}`, undefined, undefined, writer);
    const rows = Array.isArray(data?.messages) ? data.messages.flat().filter(Boolean) : [];
    return mapMessages(rows);
}
export async function sendDiscordMessage(cfg, channelId, content, writer) {
    const clean = content.trim();
    if (!clean)
        throw new DiscordAccountError("Message content is required.");
    if (clean.length > 2_000)
        throw new DiscordAccountError("Discord messages are limited to 2,000 characters.");
    const data = await fetchDiscord(cfg, `/channels/${encodeURIComponent(channelId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: clean, allowed_mentions: { parse: [] } }),
    }, undefined, writer);
    return { id: String(data?.id ?? ""), channelId: String(data?.channel_id ?? channelId), content: clean };
}
export const _internal = { messageQuery, mapMessages, validateRedirectUri };
