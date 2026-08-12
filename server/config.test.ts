import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readAgentContext } from "./config.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("private agent context", () => {
  it("reads a local context file without requiring it to exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "openmausbot-context-"));
    tempDirs.push(dir);
    const file = join(dir, "agent-context.md");
    writeFileSync(file, "\nAnthony prefers evidence-backed work.\n");

    expect(readAgentContext(file)).toBe("Anthony prefers evidence-backed work.");
    expect(readAgentContext(join(dir, "missing.md"))).toBe("");
  });

  it("caps oversized context instead of growing every provider prompt forever", () => {
    const dir = mkdtempSync(join(tmpdir(), "openmausbot-context-"));
    tempDirs.push(dir);
    const file = join(dir, "agent-context.md");
    writeFileSync(file, "x".repeat(24_100));

    const context = readAgentContext(file);
    expect(context.startsWith("x".repeat(24_000))).toBe(true);
    expect(context).toContain("Local context truncated");
  });
});
