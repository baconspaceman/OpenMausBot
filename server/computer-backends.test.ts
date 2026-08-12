import { describe, expect, it } from "vitest";

import { backendConfigStatus, buildSshArgs, buildWslArgs, isShellBackend } from "./computer-backends.ts";

describe("computer backend routing", () => {
  it("recognizes the four opt-in shell backends", () => {
    expect(["wsl", "hyperv", "qemu", "oracle"].every(isShellBackend)).toBe(true);
    expect(isShellBackend("cloud")).toBe(false);
  });

  it("builds WSL commands without a shell hop", () => {
    expect(buildWslArgs({ distro: "Ubuntu" }, "printf hello")).toEqual([
      "--distribution",
      "Ubuntu",
      "--exec",
      "bash",
      "-lc",
      "printf hello",
    ]);
  });

  it("builds SSH arguments with the guest command as one argument", () => {
    expect(
      buildSshArgs(
        { host: "198.51.100.20", port: 2222, user: "ubuntu", keyPath: "C:\\keys\\id_ed25519" },
        "printf 'hello world'",
      ),
    ).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-i",
      "C:\\keys\\id_ed25519",
      "-p",
      "2222",
      "ubuntu@198.51.100.20",
      "--",
      "printf 'hello world'",
    ]);
  });

  it("reports only non-secret backend configuration metadata", () => {
    const status = backendConfigStatus({
      computer: {
        oracle: { host: "198.51.100.20", user: "ubuntu", port: 22, keyPath: "C:\\keys\\id_ed25519" },
      },
    });
    expect(status.oracle).toMatchObject({ configured: true, host: "198.51.100.20", user: "ubuntu", port: 22 });
    expect(status.oracle).not.toHaveProperty("privateKey");
  });
});
