import { track } from "@/lib/analytics";
import { useEffect, useRef, useState } from "react";
import { Files, Mic, Monitor, Plus, Puzzle, Square } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";

export function Composer({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  // native dictation (Swift/SFSpeechRecognizer) is macOS-only; hide the mic
  // button elsewhere (browser dev keeps it — it explains how to run the app)
  const showMic = !window.ogb || window.ogb.platform === "darwin";
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [addOpen]);

  const send = () => {
    if (!text.trim() || bot.busy) return;
    dispatch({ type: "send", botId: bot.id, text: text.trim() });
    track("message_sent", { driver: bot.modelSelection?.instanceId });
    setText("");
  };

  // native dictation: partials stream into the input while the Swift
  // helper runs; the final transcript stays in the box, ready to edit/send
  useEffect(() => {
    if (!recording) return;
    const bridge = window.ogb;
    if (!bridge) {
      setRecording(false);
      return;
    }
    setSpeechError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.text === "string") {
        const base = baseText.current;
        setText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd(({ code }) => {
      setRecording(false);
      if (code === 1) {
        setSpeechError(
          "Dictation needs Microphone + Speech Recognition access — System Settings → Privacy & Security.",
        );
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording]);

  const toggleMic = () => {
    if (!window.ogb) {
      setSpeechError("Voice input needs the desktop app — run pnpm dev:desktop.");
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  const openDestination = (destination: "plugins" | "files" | "computer") => {
    setAddOpen(false);
    if (destination === "plugins") dispatch({ type: "togglePlugins", open: true });
    if (destination === "files") dispatch({ type: "toggleAppSettings", open: true });
    if (destination === "computer") dispatch({ type: "toggleComputer", open: true });
  };

  return (
    <div className="px-5 pb-5 pt-2">
      {speechError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      <div ref={addMenuRef} className="relative mx-auto flex max-w-[900px] items-center gap-2 rounded-full border border-hairline/40 bg-raised/60 py-2 pl-2 pr-2">
        <button
          onClick={() => setAddOpen((open) => !open)}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          title="Add a connector, file, or computer"
          aria-label="Add a connector, file, or computer"
          aria-expanded={addOpen}
        >
          <Plus size={20} />
        </button>
        {addOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-[292px] overflow-hidden rounded-xl border border-hairline/50 bg-card p-1.5 shadow-2xl shadow-black/50">
            <div className="px-3 py-2">
              <div className="text-[13px] font-semibold text-ink">Add to this bot</div>
              <div className="mt-0.5 text-[11px] text-ink-secondary">
                Choose the kind of capability you want OMB to use.
              </div>
            </div>
            <button
              onClick={() => openDestination("plugins")}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-raised/70"
            >
              <Puzzle size={17} className="mt-0.5 shrink-0 text-accent" />
              <span>
                <span className="block text-[13px] text-ink">Use a plugin or connector</span>
                <span className="block text-[11px] text-ink-secondary">Open Composio connected apps</span>
              </span>
            </button>
            <button
              onClick={() => openDestination("files")}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-raised/70"
            >
              <Files size={17} className="mt-0.5 shrink-0 text-ink-secondary" />
              <span>
                <span className="block text-[13px] text-ink">Share a file</span>
                <span className="block text-[11px] text-ink-secondary">
                  {state.config?.fileBus?.configured ? "File Bus is ready — open its settings" : "Configure the File Bus first"}
                </span>
              </span>
            </button>
            <button
              onClick={() => openDestination("computer")}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-raised/70"
            >
              <Monitor size={17} className="mt-0.5 shrink-0 text-ink-secondary" />
              <span>
                <span className="block text-[13px] text-ink">Use a computer</span>
                <span className="block text-[11px] text-ink-secondary">Open WSL, Hyper-V, QEMU, Oracle, or Box</span>
              </span>
            </button>
            <div className="mx-2 my-1 border-t border-hairline/40" />
            <div className="px-3 py-2 text-[11px] leading-4 text-ink-secondary">
              Attachments and local MCP discovery are being connected to this menu next; OMB will tell you which route is active.
            </div>
          </div>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          placeholder={
            recording ? "Listening…" : bot.busy ? `${bot.name} is working…` : `Message ${bot.name}`
          }
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        {bot.busy ? (
          <button
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title="Stop"
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : showMic && (
          <button
            onClick={toggleMic}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : "text-ink-secondary hover:bg-raised hover:text-ink",
            )}
            title={recording ? "Stop dictation (Esc)" : "Dictate"}
          >
            <Mic size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
