import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, RefreshCw, Search, Shield, X } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";

interface AccountStatus {
  configured: boolean;
  connected: boolean;
  clientIdConfigured: boolean;
  redirectUri: string;
  scopes: string[];
  expiresAt: number | null;
  user: { id: string; username?: string; globalName?: string } | null;
}

interface Guild {
  id: string;
  name: string;
  owner: boolean;
  permissions: string | null;
}

interface Channel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

interface Message {
  id: string;
  author: { username: string; globalName: string | null; bot: boolean } | null;
  content: string;
  timestamp: string | null;
}

const EMPTY_STATUS: AccountStatus = {
  configured: false,
  connected: false,
  clientIdConfigured: false,
  redirectUri: "",
  scopes: [],
  expiresAt: null,
  user: null,
};

export function DiscordAccountPanel() {
  const [status, setStatus] = useState<AccountStatus>(EMPTY_STATUS);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedGuild, setSelectedGuild] = useState<Guild | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"save" | "connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshStatus = () =>
    api("/api/discord-account/status")
      .then((next) => {
        setStatus(next);
        if (next.redirectUri) setRedirectUri((current) => current || next.redirectUri);
      })
      .catch((e) => setError(e.message));

  const refreshGuilds = () => {
    setLoading(true);
    setError(null);
    api("/api/discord-account/guilds")
      .then((body) => setGuilds(body.guilds ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (status.connected) refreshGuilds();
  }, [status.connected]);

  const save = async () => {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const next = await api("/api/discord-account/config", {
        method: "POST",
        body: JSON.stringify({ clientId, clientSecret, redirectUri }),
      });
      setStatus(next);
      setClientSecret("");
      setNotice("Discord OAuth settings saved locally.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setError(null);
    setNotice(null);
    try {
      const { authorizeUrl } = await api("/api/discord-account/oauth/start", { method: "POST" });
      const popup = window.open(authorizeUrl, "omb-discord-account", "width=620,height=760");
      if (!popup) throw new Error("The Discord sign-in window was blocked. Allow pop-ups and try again.");
      let tries = 0;
      const timer = window.setInterval(async () => {
        tries += 1;
        try {
          const next = await api("/api/discord-account/status");
          setStatus(next);
          if (next.connected || tries >= 30) {
            window.clearInterval(timer);
            setBusy(null);
            if (next.connected) setNotice("Discord account connected. OMB can now research the guilds your account can access.");
            else setError("Discord sign-in did not finish. Try Connect again.");
          }
        } catch (e) {
          window.clearInterval(timer);
          setBusy(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 2_000);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      const next = await api("/api/discord-account/disconnect", { method: "POST" });
      setStatus(next);
      setGuilds([]);
      setChannels([]);
      setMessages([]);
      setSelectedGuild(null);
      setSelectedChannel(null);
      setNotice("Discord account disconnected. OAuth app settings were kept locally.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const chooseGuild = async (guild: Guild) => {
    setSelectedGuild(guild);
    setSelectedChannel(null);
    setMessages([]);
    setLoading(true);
    try {
      const body = await api(`/api/discord-account/guilds/${encodeURIComponent(guild.id)}/channels`);
      setChannels((body.channels ?? []).filter((channel: Channel) => [0, 5, 10, 11, 12, 13, 15].includes(channel.type)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const chooseChannel = async (channel: Channel) => {
    setSelectedChannel(channel);
    setLoading(true);
    setError(null);
    try {
      const body = await api(`/api/discord-account/channels/${encodeURIComponent(channel.id)}/messages?limit=25`);
      setMessages(body.messages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async () => {
    if (!selectedGuild || !search.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const body = await api(`/api/discord-account/guilds/${encodeURIComponent(selectedGuild.id)}/search?content=${encodeURIComponent(search.trim())}`);
      setMessages(body.messages ?? []);
      setNotice(`Search returned ${body.messages?.length ?? 0} result(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-accent/25 bg-accent/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"><Shield size={18} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
            Discord Account Research
            {status.connected && <span className="size-1.5 rounded-full bg-success" />}
          </div>
          <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary">
            Official OAuth2 access through your account. OMB can inspect guilds and readable messages; it cannot send or modify anything automatically.
          </div>
        </div>
      </div>

      {!status.configured && (
        <div className="mt-3 rounded-lg border border-hairline/40 bg-inset/60 p-3 text-[12px] text-ink-secondary">
          Create a Discord Developer Application, add this callback URL, then paste its Client ID and Client Secret here. The secret is write-only in OMB.
        </div>
      )}

      <div className="mt-3 grid gap-2">
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={status.clientIdConfigured ? "Client ID saved (paste to replace)" : "Discord Client ID"} className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12px] text-ink placeholder:text-ink-secondary focus:outline-none" />
        <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={status.configured ? "Client Secret saved (paste to replace)" : "Discord Client Secret"} autoComplete="off" className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12px] text-ink placeholder:text-ink-secondary focus:outline-none" />
        <input value={redirectUri || status.redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder="http://127.0.0.1:8799/api/discord-account/oauth/callback" className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12px] text-ink placeholder:text-ink-secondary focus:outline-none" />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={save} disabled={busy !== null || (!clientId.trim() && !status.clientIdConfigured) || (!clientSecret.trim() && !status.configured)} className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink disabled:opacity-50">
          {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save locally
        </button>
        <button onClick={connect} disabled={busy !== null || !status.configured} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white disabled:opacity-50">
          {busy === "connect" ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />} {status.connected ? "Reconnect" : "Connect Discord"}
        </button>
        {status.connected && <button onClick={disconnect} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-danger disabled:opacity-50">{busy === "disconnect" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Disconnect</button>}
      </div>

      {status.connected && (
        <div className="mt-4 border-t border-hairline/30 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] text-ink-secondary">Connected as <span className="text-ink">{status.user?.globalName || status.user?.username || "Discord user"}</span> · {guilds.length} guild(s)</div>
            <button onClick={refreshGuilds} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink" title="Refresh guilds"><RefreshCw size={14} className={cn(loading && "animate-spin")} /></button>
          </div>
          <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-hairline/30 bg-inset/40">
            {guilds.length === 0 && <div className="p-3 text-[12px] text-ink-secondary">No guilds were returned, or the Discord account API did not grant this scope.</div>}
            {guilds.map((guild) => <button key={guild.id} onClick={() => chooseGuild(guild)} className={cn("flex w-full items-center justify-between border-b border-hairline/20 px-3 py-2 text-left text-[12px] last:border-0 hover:bg-raised", selectedGuild?.id === guild.id && "bg-raised")}><span className="truncate text-ink">{guild.name}</span>{guild.owner && <span className="ml-2 shrink-0 text-[10px] text-ink-secondary">owner</span>}</button>)}
          </div>
          {selectedGuild && <div className="mt-2 rounded-lg border border-hairline/30 bg-inset/30 p-2">
            <div className="mb-2 text-[12px] text-ink">{selectedGuild.name} channels</div>
            <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
              {channels.map((channel) => <button key={channel.id} onClick={() => chooseChannel(channel)} className={cn("rounded-md bg-raised px-2 py-1 text-[11px] text-ink-secondary hover:text-ink", selectedChannel?.id === channel.id && "text-accent")}>#{channel.name}</button>)}
              {!channels.length && <span className="text-[11px] text-ink-secondary">No readable text channels returned.</span>}
            </div>
            <div className="mt-2 flex gap-1.5"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} placeholder="Search this guild" className="min-w-0 flex-1 rounded-md border border-hairline/30 bg-inset px-2 py-1.5 text-[11px] text-ink placeholder:text-ink-secondary focus:outline-none" /><button onClick={runSearch} disabled={!search.trim() || loading} className="rounded-md bg-raised px-2 text-ink-secondary disabled:opacity-50"><Search size={13} /></button></div>
            {messages.length > 0 && <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">{messages.map((message) => <div key={message.id} className="rounded-md bg-inset/80 px-2.5 py-2 text-[11px]"><div className="text-ink-secondary">{message.author?.globalName || message.author?.username || "unknown"}</div><div className="mt-0.5 whitespace-pre-wrap break-words text-ink">{message.content || "[attachment or embed]"}</div></div>)}</div>}
          </div>}
        </div>
      )}

      {notice && <div className="mt-2 text-[11px] text-success">{notice}</div>}
      {error && <div className="mt-2 text-[11px] text-danger">{error}</div>}
    </div>
  );
}
