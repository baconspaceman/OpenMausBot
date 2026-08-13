const DEFAULT_DISCORD_URL = "http://127.0.0.1:8766/mcp";
// The user's Codex config may already contain a stdio server named `discord`.
// Keep OMB's managed HTTP route distinct so Codex cannot merge two transports.
const DEFAULT_DISCORD_NAME = "omb-discord";
const PROBE_TIMEOUT_MS = 1_500;
function candidateServers(cfg) {
    const configured = cfg.localMcp?.servers ?? {};
    const merged = {
        [DEFAULT_DISCORD_NAME]: { url: process.env.OPENMAUSBOT_DISCORD_MCP_URL || DEFAULT_DISCORD_URL },
        ...configured,
    };
    return Object.entries(merged)
        .filter(([, server]) => server.enabled !== false && typeof server.url === "string" && server.url.trim())
        .map(([name, server]) => ({ name, url: server.url.trim(), headers: server.headers }));
}
async function reachable(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        // HEAD is intentionally enough: a 405 still proves the MCP listener is
        // alive, while avoiding an initialize request and an orphaned MCP session.
        await fetch(url, { method: "HEAD", signal: controller.signal });
        return true;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Return only configured local MCP endpoints that are reachable right now. */
export async function discoverLocalMcp(cfg) {
    const candidates = candidateServers(cfg);
    const results = await Promise.all(candidates.map(async (server) => (await reachable(server.url) ? server : null)));
    return results.filter((server) => server !== null);
}
export const _internal = { candidateServers, reachable };
