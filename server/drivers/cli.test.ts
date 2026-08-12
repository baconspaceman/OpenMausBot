// CLI spawn-helper contract: env inheritance (a probe that drops the
// parent env can't find anything on PATH), shim unwrapping across the
// real .cmd formats in the wild, and safe failure for what can't be
// unwrapped. Runs on every OS — this file is most of the point of the
// windows CI leg.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { _internal, cliExec, cliVersion, killProcessTree } from "./cli.ts";

const PRINT_MARKER = "process.stdout.write(String(process.env.OMB_TEST_MARKER))";

describe("cliExec", () => {
  afterEach(() => {
    delete process.env.OMB_TEST_MARKER;
  });

  it("inherits the parent environment by default", async () => {
    // regression: passing env:{} to execFile is an EMPTY env, not inherit —
    // that made every PATH-installed CLI probe ENOENT
    process.env.OMB_TEST_MARKER = "inherited-ok";
    const r = await cliExec(process.execPath, ["-e", PRINT_MARKER]);
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("inherited-ok");
  });

  it("uses the explicit env verbatim when one is given", async () => {
    process.env.OMB_TEST_MARKER = "should-not-appear";
    const r = await cliExec(process.execPath, ["-e", PRINT_MARKER], {
      env: { OMB_TEST_MARKER: "explicit-wins", PATH: process.env.PATH ?? "" },
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("explicit-wins");
  });

  it("reports failure, not a throw, for a missing binary", async () => {
    const r = await cliExec(join(tmpdir(), "omb-definitely-not-a-cli"), ["--version"]);
    expect(r.ok).toBe(false);
  });
});

describe("cliVersion", () => {
  it("returns null for a missing CLI", async () => {
    expect(await cliVersion(join(tmpdir(), "omb-definitely-not-a-cli"))).toBeNull();
  });

  it("returns trimmed stdout for a working CLI", async () => {
    expect(await cliVersion(process.execPath)).toBe(process.version);
  });
});

describe("shimScriptTarget", () => {
  let dir: string;
  const shim = (content: string) => {
    dir = mkdtempSync(join(tmpdir(), "omb-shim-"));
    const p = join(dir, "codex.cmd");
    writeFileSync(p, content);
    return p;
  };

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("unwraps the current npm cmd-shim format (%dp0%)", () => {
    const p = shim(
      '@SETLOCAL\r\n@SET "dp0=%~dp0"\r\n@"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    );
    const target = _internal.shimScriptTarget(p);
    expect(target).not.toBeNull();
    expect(target!.endsWith("codex.js")).toBe(true);
  });

  it("unwraps the yarn/older cmd-shim format (%~dp0, no trailing %)", () => {
    const p = shim('@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\..\\pkg\\bin\\codex.js" %*\r\n)\r\n');
    const target = _internal.shimScriptTarget(p);
    expect(target).not.toBeNull();
    expect(target!.endsWith("codex.js")).toBe(true);
  });

  it("gives up on unknown %VAR% tokens instead of guessing", () => {
    const p = shim('@"%MYSTERY_HOME%\\bin\\codex.js" %*\r\n');
    expect(_internal.shimScriptTarget(p)).toBeNull();
  });

  it("gives up when there is no quoted JS entry (exe-style shims)", () => {
    const p = shim('@ECHO OFF\r\nbun.exe run something %*\r\n');
    expect(_internal.shimScriptTarget(p)).toBeNull();
  });
});

describe("knownCliPaths", () => {
  it("finds a per-user npm shim when the packaged PATH omits it", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), "omb-cli-paths-"));
    const npmBin = join(root, "npm");
    mkdirSync(npmBin);
    const shim = join(npmBin, "codex.cmd");
    writeFileSync(shim, "@echo off\r\n");
    const previous = process.env.APPDATA;
    try {
      process.env.APPDATA = root;
      expect(_internal.knownCliPaths("codex")).toContain(shim);
    } finally {
      if (previous === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("killProcessTree", () => {
  it("is a no-op for undefined and for an already-dead pid", () => {
    expect(() => killProcessTree(undefined)).not.toThrow();
    expect(() => killProcessTree(999_999_999)).not.toThrow();
  });
});
