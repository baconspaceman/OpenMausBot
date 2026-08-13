import { describe, expect, it } from "vitest";
import { _internal } from "./github-research.ts";

describe("read-only GitHub link parsing", () => {
  it("recognizes repositories, issues, pull requests, and files", () => {
    expect(_internal.targetFromUrl("https://github.com/openai/example")).toMatchObject({ kind: "repo", owner: "openai", repo: "example" });
    expect(_internal.targetFromUrl("https://github.com/openai/example/issues/12")).toMatchObject({ kind: "issue", number: "12" });
    expect(_internal.targetFromUrl("https://github.com/openai/example/pull/7")).toMatchObject({ kind: "pull", number: "7" });
    expect(_internal.targetFromUrl("https://github.com/openai/example/blob/main/src/index.ts")).toMatchObject({ kind: "blob", ref: "main", path: "src/index.ts" });
  });

  it("rejects non-GitHub links", () => {
    expect(() => _internal.targetFromUrl("https://example.com/project")).toThrow(/github.com/);
  });
});
