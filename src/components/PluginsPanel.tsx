// Connected apps marketplace, backed by Composio Connect. Catalog comes
// from /api/connectors/catalog — the full toolkit list with logos when a
// Composio API key is configured, a curated set otherwise. Icons resolve
// logo → favicon → monogram.
import { useCallback, useEffect, useRef, useState } from "react";
import { Info, Loader2, RefreshCw, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { DiscordAccountPanel } from "./DiscordAccountPanel";

interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
}

interface ConnectionState {
  connected: boolean;
  status?: string;
}

function ServiceIcon({ card }: { card: ToolkitCard }) {
  // 0 = official logo, 1 = favicon by domain, 2 = monogram
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) {
    return <img src={card.logo} alt="" className="size-8 rounded-md" onError={() => setStage(1)} />;
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        className="size-8 rounded-md"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className="flex size-8 items-center justify-center rounded-md bg-raised text-[13px] font-semibold text-ink-secondary">
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function PluginsPanel() {
  const { dispatch } = useStore();
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "curated">("curated");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Record<string, ConnectionState>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const pollingTimers = useRef(new Set<number>());

  const refreshStatus = useCallback((slugs: string[]): Promise<Record<string, ConnectionState>> => {
    if (!slugs.length) return Promise.resolve({});
    setRefreshing(true);
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => {
        const next = r.services ?? {};
        setStatus((previous) => ({ ...previous, ...next }));
        setStatusError(null);
        return next;
      })
      .catch((e) => {
        setStatusError(e.message);
        return {};
      })
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => () => {
    pollingTimers.current.forEach((timer) => window.clearInterval(timer));
    pollingTimers.current.clear();
  }, []);

  useEffect(() => {
    let alive = true;
    api("/api/connectors/catalog")
      .then((r) => {
        if (!alive) return;
        setCards(r.cards ?? []);
        setSource(r.source ?? "curated");
        setConfigured(Boolean(r.configured));
        if (r.configured) void refreshStatus((r.cards ?? []).map((c: ToolkitCard) => c.slug).slice(0, 40));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [refreshStatus]);

  const connect = async (slug: string) => {
    setBusySlug(slug);
    setError(null);
    setStatusError(null);
    try {
      const { url } = await api(`/api/connectors/${slug}/authorize`, { method: "POST" });
      if (typeof url !== "string" || !url) throw new Error("No authorization URL was returned by Composio Connect.");
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (popup === null) setError("The sign-in page could not be opened. Allow pop-ups and try again.");

      // OAuth finishes in the browser. Keep the row busy while we look for the callback.
      let tries = 0;
      const timer = window.setInterval(() => {
        tries += 1;
        void refreshStatus([slug]).then((next) => {
          if (next[slug]?.connected || tries >= 12) {
            window.clearInterval(timer);
            pollingTimers.current.delete(timer);
            setBusySlug(null);
            if (!next[slug]?.connected && tries >= 12) {
              setError(`Finish the ${slug} sign-in in your browser, then refresh this list.`);
            }
          }
        });
      }, 4000);
      pollingTimers.current.add(timer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusySlug(null);
    }
  };

  const disconnect = (slug: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const visible = (cards ?? []).filter(
    (c) => !search || `${c.label} ${c.slug} ${c.blurb}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
      onClick={() => dispatch({ type: "togglePlugins", open: false })}
    >
      <div
        className="animate-pop-in flex h-[90vh] max-h-[calc(100vh-2rem)] min-h-0 w-[560px] flex-col rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between">
          <div>
            <div className="text-[17px] font-semibold text-ink">Connected apps</div>
            <div className="mt-0.5 text-[11px] text-ink-secondary">
              {configured === null ? "Checking connector setup…" : configured ? "Composio Connect is ready" : "Composio Connect setup needed"}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refreshStatus(visible.map((c) => c.slug).slice(0, 40))}
              className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
              title="Refresh connection status"
            >
              <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
            </button>
            <button
              onClick={() => dispatch({ type: "togglePlugins", open: false })}
              className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <div className="mt-1 text-[13px] text-ink-secondary">
            Apps your bots can use through Composio Connect. Connecting an app opens its sign-in page in your browser.
          </div>

          <div className="mt-3 flex gap-2 rounded-lg border border-hairline/40 bg-inset/50 px-3 py-2.5 text-[12px] leading-4 text-ink-secondary">
            <Info size={15} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <span className="font-medium text-ink">Two extension routes:</span> this list is for Composio connected apps. Local MCP plugins—such as a locally running Discord bridge—are separate and are not discovered here yet.
            </div>
          </div>

          <div className="mt-3">
            <DiscordAccountPanel />
          </div>

          {configured === false && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
              No Composio Connect key yet —{" "}
              <button
                className="underline"
                onClick={() => {
                  dispatch({ type: "togglePlugins", open: false });
                  dispatch({ type: "toggleAppSettings", open: true });
                }}
              >
                add one in App Settings
              </button>{" "}
              to connect apps.
            </div>
          )}
          {configured && source === "curated" && (
            <div className="mt-3 text-[12px] text-ink-secondary">
              Showing a curated set.{" "}
              <button
                className="underline hover:text-ink"
                onClick={() => {
                  dispatch({ type: "togglePlugins", open: false });
                  dispatch({ type: "toggleAppSettings", open: true });
                }}
              >
                Add a Composio API key
              </button>{" "}
              to browse the full catalog.
            </div>
          )}
          {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
          {statusError && <div className="mt-2 text-[12px] text-danger">Connection status unavailable: {statusError}</div>}

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps"
            className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />

          <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-xl border border-hairline/40">
            {cards === null ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-secondary">
                <Loader2 size={14} className="animate-spin" /> Loading catalog…
              </div>
            ) : (
              visible.map((card, i) => {
                const connected = status[card.slug]?.connected;
                const busy = busySlug === card.slug;
                return (
                  <div
                    key={card.slug}
                    className={cn(
                      "flex items-center gap-3 bg-card px-4 py-3",
                      i > 0 && "border-t border-hairline/40",
                    )}
                  >
                    <ServiceIcon card={card} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
                        {card.label}
                        {connected && <span className="size-1.5 rounded-full bg-success" />}
                      </div>
                      <div className="truncate text-[12px] text-ink-secondary">{card.blurb}</div>
                    </div>
                    <button
                      disabled={configured !== true || busy}
                      onClick={() => (connected ? disconnect(card.slug) : connect(card.slug))}
                      className={cn(
                        "w-[92px] rounded-lg py-1.5 text-[13px] disabled:opacity-50",
                        connected
                          ? "bg-raised text-ink-secondary hover:text-danger"
                          : "bg-raised text-ink hover:bg-raised-hover",
                      )}
                    >
                      {busy ? (
                        <Loader2 size={13} className="mx-auto animate-spin" />
                      ) : connected ? (
                        "Disconnect"
                      ) : (
                        "Connect"
                      )}
                    </button>
                  </div>
                );
              })
            )}
            {cards !== null && visible.length === 0 && (
              <div className="py-8 text-center text-[13px] text-ink-secondary">No apps match.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
