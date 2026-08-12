import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";

type BackendKey = "wsl" | "hyperv" | "qemu" | "oracle";
type SshFields = { host: string; port: number; user: string; keyPath: string };

const emptySsh = (): SshFields => ({ host: "", port: 22, user: "", keyPath: "" });

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-ink-secondary">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
      />
    </label>
  );
}

function SshFields({ value, onChange }: { value: SshFields; onChange: (value: SshFields) => void }) {
  const set = (key: keyof SshFields, raw: string) => onChange({ ...value, [key]: key === "port" ? Number(raw) || 22 : raw });
  return (
    <>
      <div className="mt-2 flex gap-2">
        <Field label="Host" value={value.host} onChange={(v) => set("host", v)} placeholder="192.0.2.10" />
        <Field label="Port" value={value.port} onChange={(v) => set("port", v)} type="number" />
        <Field label="User" value={value.user} onChange={(v) => set("user", v)} placeholder="ubuntu" />
      </div>
      <div className="mt-2">
        <Field label="Private-key path (path only; never paste the key)" value={value.keyPath} onChange={(v) => set("keyPath", v)} placeholder="C:\\Users\\you\\.ssh\\id_ed25519" />
      </div>
    </>
  );
}

export function ComputerBackendSettings() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState<BackendKey | null>(null);
  const [saved, setSaved] = useState<BackendKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = state.config?.computer;
  const [wslDistro, setWslDistro] = useState("");
  const [hypervVm, setHypervVm] = useState("");
  const [hypervSsh, setHypervSsh] = useState(emptySsh());
  const [qemuImage, setQemuImage] = useState("");
  const [qemuPath, setQemuPath] = useState("");
  const [qemuMemory, setQemuMemory] = useState(4096);
  const [qemuSsh, setQemuSsh] = useState(emptySsh());
  const [oracle, setOracle] = useState(emptySsh());

  useEffect(() => {
    if (!config) return;
    setWslDistro(config.wsl.distro ?? "");
    setHypervVm(config.hyperv.vmName);
    setHypervSsh({ ...emptySsh(), ...(config.hyperv.ssh ?? {}) });
    setQemuImage(config.qemu.imagePath);
    setQemuPath(config.qemu.qemuPath);
    setQemuMemory(config.qemu.memoryMb);
    setQemuSsh({ ...emptySsh(), ...(config.qemu.ssh ?? {}) });
    setOracle({ ...emptySsh(), ...(config.oracle ?? {}) });
  }, [config]);

  const save = (backend: BackendKey, value: unknown) => {
    setSaving(backend);
    setSaved(null);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ computer: { [backend]: value } }) })
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setSaved(backend);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(null));
  };

  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Computer backends</div>
      <div className="mt-0.5 text-[13px] leading-5 text-ink-secondary">
        Add the routes now; select one per bot in its Computer panel. Box stays available for the desktop cloud path.
        WSL2, Hyper-V, QEMU, and Oracle SSH currently expose shell access, not screen capture.
      </div>
      <div className="mt-4 space-y-4">
        <div className="border-b border-hairline/30 pb-4">
          <div className="text-[13px] font-medium text-ink">WSL2</div>
          <div className="mt-1 text-[11px] text-ink-secondary">Free local Linux. Leave distro blank to use the first installed distribution.</div>
          <div className="mt-2"><Field label="Distribution (optional)" value={wslDistro} onChange={setWslDistro} placeholder="Ubuntu" /></div>
          <button onClick={() => save("wsl", { distro: wslDistro.trim() })} disabled={saving !== null} className="mt-3 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover">{saving === "wsl" ? <Loader2 size={12} className="animate-spin" /> : saved === "wsl" ? "Saved" : "Save"}</button>
        </div>

        <div className="border-b border-hairline/30 pb-4">
          <div className="text-[13px] font-medium text-ink">Hyper-V</div>
          <div className="mt-1 text-[11px] text-ink-secondary">Use an existing Windows VM. The VM must have SSH enabled for agent control.</div>
          <div className="mt-2"><Field label="VM name" value={hypervVm} onChange={setHypervVm} placeholder="GamingLinux" /></div>
          <SshFields value={hypervSsh} onChange={setHypervSsh} />
          <button onClick={() => save("hyperv", { vmName: hypervVm.trim(), ssh: hypervSsh })} disabled={saving !== null} className="mt-3 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover">{saving === "hyperv" ? <Loader2 size={12} className="animate-spin" /> : saved === "hyperv" ? "Saved" : "Save"}</button>
        </div>

        <div className="border-b border-hairline/30 pb-4">
          <div className="text-[13px] font-medium text-ink">QEMU</div>
          <div className="mt-1 text-[11px] text-ink-secondary">Boot an OS image with user-mode networking and SSH forwarded to the configured port.</div>
          <div className="mt-2"><Field label="Disk image path" value={qemuImage} onChange={setQemuImage} placeholder="D:\\VMs\\gaming.qcow2" /></div>
          <div className="mt-2 flex gap-2"><Field label="QEMU executable (optional)" value={qemuPath} onChange={setQemuPath} placeholder="qemu-system-x86_64.exe" /><Field label="Memory (MB)" value={qemuMemory} onChange={(v) => setQemuMemory(Number(v) || 4096)} type="number" /></div>
          <SshFields value={qemuSsh} onChange={setQemuSsh} />
          <button onClick={() => save("qemu", { imagePath: qemuImage.trim(), qemuPath: qemuPath.trim(), memoryMb: qemuMemory, ssh: qemuSsh })} disabled={saving !== null} className="mt-3 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover">{saving === "qemu" ? <Loader2 size={12} className="animate-spin" /> : saved === "qemu" ? "Saved" : "Save"}</button>
        </div>

        <div>
          <div className="text-[13px] font-medium text-ink">Oracle SSH</div>
          <div className="mt-1 text-[11px] text-ink-secondary">Point at an Oracle Cloud VM or another SSH host. No token is stored here—only connection metadata and a key-file path.</div>
          <SshFields value={oracle} onChange={setOracle} />
          <button onClick={() => save("oracle", oracle)} disabled={saving !== null} className="mt-3 rounded-lg bg-raised px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover">{saving === "oracle" ? <Loader2 size={12} className="animate-spin" /> : saved === "oracle" ? "Saved" : "Save"}</button>
        </div>
      </div>
      {error && <div className="mt-3 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
