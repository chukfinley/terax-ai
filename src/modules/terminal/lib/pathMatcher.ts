/**
 * Match file-path candidates in a single terminal line. The output is
 * deliberately permissive — false positives are filtered later by an
 * existence check against the filesystem. We only do *cheap* rejection
 * here for tokens that obviously cannot be files (URLs, semver, hashes,
 * timestamps), to avoid wasting fs probes.
 *
 * Each result includes the byte range *in the input line* so xterm can
 * convert it to a buffer-cell range for underline + click hit-testing.
 */
export interface PathCandidate {
  /** The exact substring as it appears in the line. */
  text: string;
  /** Inclusive start index into the line. */
  start: number;
  /** Exclusive end index into the line. */
  end: number;
  /** The file-path part (without trailing `:line[:col]`). */
  path: string;
  line?: number;
  col?: number;
}

const MAX_LINE_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 512;
const MAX_CANDIDATES_PER_LINE = 32;

// Matches path-like tokens with optional :LINE[:COL] suffix.
// Groups:
//   (1) LINE number if present
//   (2) COL number if present
//
// Path forms handled:
//   C:\Win\path or C:/Win/path  (Windows drive)
//   /abs/path                   (POSIX absolute)
//   ./rel or ../rel             (relative with explicit prefix)
//   bare.ext                    (single token with dot)
//   multi/segment               (contains slash)
//
// We allow leading `/` explicitly in the alternation so POSIX absolute paths
// are captured with their leading slash.
const PATH_REGEX =
  /(?:[A-Za-z]:[\\/][A-Za-z0-9_./\\-]*|\/[A-Za-z0-9_~][A-Za-z0-9_./\\-]*|\.{1,2}[\\/][A-Za-z0-9_~][A-Za-z0-9_./\\-]*|[A-Za-z0-9_~][A-Za-z0-9_./\\-]+)(?::(\d+)(?::(\d+))?)?/g;

// Pure number (123 or 12.345) — no slash, no letter.
const PURE_NUMBER_REGEX = /^\d+(?:\.\d+)*$/;
// Semver-ish: 1.2.3, 1.2.3-rc.1 — three or more dot-separated digit groups.
const SEMVER_REGEX = /^\d+\.\d+(?:\.\d+)+(?:[.\-][A-Za-z0-9]+)*$/;
// Hex hash: 7+ hex chars, no dot, no slash.
const HEX_HASH_REGEX = /^[0-9a-f]{7,}$/i;

// Well-known extensionless project files. Bare tokens (no slash, no dot) are
// normally rejected to avoid underlining every word, but these are real files
// users expect to click — e.g. an uppercase `LICENSE`. Matched case-insensitively
// against the whole token (these never have a path separator when bare).
const KNOWN_EXTENSIONLESS = new Set([
  "license",
  "licence",
  "readme",
  "makefile",
  "dockerfile",
  "containerfile",
  "copying",
  "authors",
  "changelog",
  "contributing",
  "notice",
  "codeowners",
  "gemfile",
  "rakefile",
  "procfile",
  "vagrantfile",
  "brewfile",
  "justfile",
  "todo",
  "install",
  "news",
  "owners",
]);

function looksLikeNonPath(token: string): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return true;
  if (PURE_NUMBER_REGEX.test(token)) return true;
  if (SEMVER_REGEX.test(token)) return true;
  if (HEX_HASH_REGEX.test(token)) return true;

  // Bare token (no path separator). These include `ls` output — plain file
  // AND directory names (`src`, `node_modules`, `LICENSE`). We let them through
  // to the real fs existence check (resolved against the terminal's cwd), which
  // is the actual gate: only names that exist on disk get underlined. The cheap
  // rejections above (numbers, semver, hashes) already filter obvious non-paths.
  // The one extra rule: a token WITH a dot must have a plausible extension
  // (1-6 letter/digit chars) so we don't flag "foo." or version-y "foo.123".
  if (!token.includes("/") && !token.includes("\\")) {
    if (KNOWN_EXTENSIONLESS.has(token.toLowerCase())) return false;
    const dot = token.lastIndexOf(".");
    if (dot < 0) {
      // Bare token, no extension (e.g. `src`, `node_modules`): allow it — but
      // not date/timestamp-like tokens (`2026-05-22`, `2026-05-22T12`), which
      // are almost never filenames and would be probed needlessly.
      if (/^\d{4}-\d{2}-\d{2}/.test(token)) return true;
      return false;
    }
    const ext = token.slice(dot + 1);
    if (!/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(ext)) return true;
  }
  return false;
}

export function extractPathCandidates(line: string): PathCandidate[] {
  if (line.length > MAX_LINE_LENGTH) return [];

  const out: PathCandidate[] = [];
  // Reset the regex's lastIndex — the `g` flag preserves state across calls.
  PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_REGEX.exec(line)) !== null) {
    if (out.length >= MAX_CANDIDATES_PER_LINE) break;
    const text = match[0];
    const start = match.index;
    const end = start + text.length;
    const lineNum = match[1] !== undefined ? Number(match[1]) : undefined;
    const colNum = match[2] !== undefined ? Number(match[2]) : undefined;

    // Reject tokens that are part of a URL. In `https://example.com/foo.ts`,
    // the regex matches `/example.com/foo.ts` (POSIX-absolute form) starting
    // at the second `/` of `://`. Check for `://` in the two characters before
    // the token's start (which would be `:/` sitting before our leading `/`).
    if (start >= 2 && line.slice(start - 2, start) === ":/") continue;
    // Also catch if the matched token itself starts with `://` (edge case).
    if (text.startsWith("://")) continue;

    // Strip the :LINE[:COL] suffix to get the bare path.
    let path = text;
    if (lineNum !== undefined) {
      // For Windows paths starting with "C:", skip the drive colon.
      const searchFrom = /^[A-Za-z]:/.test(text) ? 2 : 0;
      const colonIdx = text.indexOf(":", searchFrom);
      if (colonIdx !== -1) path = text.slice(0, colonIdx);
    }
    if (looksLikeNonPath(path)) continue;
    out.push({ text, start, end, path, line: lineNum, col: colNum });
  }
  return out;
}
