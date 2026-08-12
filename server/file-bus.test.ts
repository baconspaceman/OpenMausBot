import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { listFileBus, transferFile } from "./file-bus.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OpenMausBot File Bus", () => {
  it("moves a host file through the staging root", async () => {
    const root = mkdtempSync(join(tmpdir(), "omb-file-bus-"));
    roots.push(root);
    writeFileSync(join(root, "source.txt"), "hello from the host");

    const result = await transferFile(
      { fileBus: { root } },
      { backend: "host", path: "source.txt" },
      { backend: "host", path: "nested/copy.txt" },
    );

    expect(result).toMatchObject({ ok: true, bytes: 19 });
    expect(readFileSync(join(root, "nested", "copy.txt"), "utf8")).toBe("hello from the host");
  });

  it("keeps host locations inside the configured root", async () => {
    const root = mkdtempSync(join(tmpdir(), "omb-file-bus-"));
    roots.push(root);
    writeFileSync(join(root, "source.txt"), "safe");

    await expect(
      transferFile(
        { fileBus: { root } },
        { backend: "host", path: "source.txt" },
        { backend: "host", path: "../outside.txt" },
      ),
    ).rejects.toThrow("escapes the File Bus root");
  });

  it("does not list the private temporary transfer directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "omb-file-bus-"));
    roots.push(root);
    writeFileSync(join(root, "visible.txt"), "visible");

    const listed = await listFileBus({ fileBus: { root } });
    expect(listed.files).toEqual(["visible.txt"]);
  });
});
