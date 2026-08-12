import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";

export function FileBusSettings() {
  const { state, dispatch } = useStore();
  const status = state.config?.fileBus;
  const [root, setRoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRoot(status?.root ?? "");
  }, [status?.root]);

  const save = () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ fileBus: { root: root.trim() } }) })
      .then((next: ConfigStatus) => {
        dispatch({ type: "configStatus", config: next });
        setSaved(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">OpenMausBot File Bus</div>
      <div className="mt-0.5 text-[13px] leading-5 text-ink-secondary">
        One shared staging route for every bot. Host paths used by file_transfer are relative to this folder;
        WSL2 and SSH-capable guests use their native paths.
      </div>
      <label className="mt-3 flex flex-col gap-1 text-[11px] text-ink-secondary">
        Host File Bus root
        <input
          value={root}
          onChange={(event) => setRoot(event.target.value)}
          placeholder="Leave blank for ~/.openmausbot/file-bus"
          className="min-w-0 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
        />
      </label>
      <div className="mt-2 text-[11px] text-ink-secondary">
        {status?.exists ? "Ready" : "Created automatically on first use"} · {status?.root ?? "default root"}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="mt-3 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? "Saved" : "Save"}
      </button>
      {error && <div className="mt-3 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
