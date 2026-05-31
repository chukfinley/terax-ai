// Map Claude Code's tool names to Terax's internal tool ids so the shared
// `Tool` component resolves the same icons, labels, and input summaries it uses
// for the built-in agent. Unknown tools fall through to the generic rendering.
export const CLAUDE_TOOL_TO_TERAX: Record<string, string> = {
  Bash: "bash_run",
  BashOutput: "bash_logs",
  KillShell: "bash_kill",
  Read: "read_file",
  Write: "write_file",
  Edit: "edit",
  MultiEdit: "multi_edit",
  NotebookEdit: "edit",
  Glob: "glob",
  Grep: "grep",
  LS: "list_directory",
  TodoWrite: "todo_write",
  Task: "run_subagent",
};

export function teraxToolName(claudeName: string): string {
  return CLAUDE_TOOL_TO_TERAX[claudeName] ?? claudeName;
}

export type DiffInput = {
  path: string;
  originalContent: string;
  proposedContent: string;
  isNewFile: boolean;
};

/**
 * Extract before/after diffs from a file-mutating tool's input so they can be
 * shown in the shared diff renderer. Edit -> one diff (old/new snippet); Write
 * -> whole new file; MultiEdit -> one diff per edit.
 */
export function diffsFromTool(name: string, input: unknown): DiffInput[] {
  if (!input || typeof input !== "object") return [];
  const i = input as Record<string, unknown>;
  const path = typeof i.file_path === "string" ? i.file_path : "";
  if (!path) return [];

  if (name === "Edit" || name === "NotebookEdit") {
    const oldStr =
      typeof i.old_string === "string"
        ? i.old_string
        : typeof i.old_source === "string"
          ? i.old_source
          : "";
    const newStr =
      typeof i.new_string === "string"
        ? i.new_string
        : typeof i.new_source === "string"
          ? i.new_source
          : "";
    return [{ path, originalContent: oldStr, proposedContent: newStr, isNewFile: false }];
  }

  if (name === "Write") {
    const content = typeof i.content === "string" ? i.content : "";
    return [{ path, originalContent: "", proposedContent: content, isNewFile: true }];
  }

  if (name === "MultiEdit" && Array.isArray(i.edits)) {
    const out: DiffInput[] = [];
    for (const e of i.edits) {
      if (!e || typeof e !== "object") continue;
      const ed = e as Record<string, unknown>;
      out.push({
        path,
        originalContent: typeof ed.old_string === "string" ? ed.old_string : "",
        proposedContent: typeof ed.new_string === "string" ? ed.new_string : "",
        isNewFile: false,
      });
    }
    return out;
  }

  return [];
}
