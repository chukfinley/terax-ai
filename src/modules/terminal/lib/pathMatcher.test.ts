import { describe, expect, it } from "vitest";
import { extractPathCandidates } from "./pathMatcher";

// The matcher is deliberately permissive: bare names (including `ls` output —
// plain files AND directories) are emitted as candidates, and a real fs
// existence check (resolved against the terminal cwd) is the actual gate that
// decides which ones underline. So these tests check that (a) real paths are
// emitted, (b) the cheap obvious-non-path rejections (URLs, numbers, semver,
// hashes, timestamps) still drop those specific tokens.
describe("extractPathCandidates", () => {
  const paths = (line: string) => extractPathCandidates(line).map((c) => c.path);

  it("matches a relative compiler path with line and col", () => {
    const out = extractPathCandidates("src/foo.ts:42:5: error TS2322");
    expect(out.find((c) => c.path === "src/foo.ts")).toMatchObject({
      line: 42,
      col: 5,
    });
  });

  it("matches a relative path with only a line number", () => {
    const out = extractPathCandidates("see ./bar.rs:7 for details");
    expect(out.find((c) => c.path === "./bar.rs")).toMatchObject({
      line: 7,
      col: undefined,
    });
  });

  it("matches an absolute path", () => {
    expect(paths("opened /etc/hosts")).toContain("/etc/hosts");
  });

  it("matches a Windows-style drive path", () => {
    expect(paths("see C:\\Users\\me\\notes.md")).toContain("C:\\Users\\me\\notes.md");
  });

  it("matches a bare filename with extension", () => {
    expect(paths("touched README.md and package.json")).toEqual(
      expect.arrayContaining(["README.md", "package.json"]),
    );
  });

  it("emits bare names so `ls` files and directories are clickable", () => {
    expect(paths("src docs node_modules LICENSE")).toEqual(
      expect.arrayContaining(["src", "docs", "node_modules", "LICENSE"]),
    );
  });

  it("rejects the path part of URLs (left to WebLinksAddon)", () => {
    const p = paths("see https://example.com/foo.ts");
    expect(p.some((x) => x.includes("example.com"))).toBe(false);
  });

  it("rejects semver, hex hashes, and bare numbers", () => {
    const p = paths("version 1.2.3 sha abc1234def5 num 12.345");
    expect(p).not.toContain("1.2.3");
    expect(p).not.toContain("abc1234def5");
    expect(p).not.toContain("12.345");
  });

  it("rejects timestamps", () => {
    const p = paths("[2026-05-22T12:34:56] hi");
    expect(p.some((x) => x.includes("2026-05-22"))).toBe(false);
  });

  it("skips lines longer than 1024 chars", () => {
    const big = "a".repeat(1100) + " /etc/hosts";
    expect(extractPathCandidates(big)).toEqual([]);
  });

  it("caps results at 32 per line", () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `f${i}.ts`).join(" ");
    expect(extractPathCandidates(tokens).length).toBeLessThanOrEqual(32);
  });

  it("preserves correct ranges for matches", () => {
    const out = extractPathCandidates("a.ts and b.ts");
    expect(out.find((c) => c.path === "a.ts")).toMatchObject({ start: 0, end: 4 });
    expect(out.find((c) => c.path === "b.ts")).toMatchObject({ start: 9, end: 13 });
  });
});
