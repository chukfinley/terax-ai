// Pure parser for Claude Code session transcripts (~/.claude/projects/<enc>/<id>.jsonl).
// Each line is one JSON object with a `type`. We render `user` and `assistant`
// lines and ignore the many meta types (mode, permission-mode, attachment,
// system, file-history-snapshot, ai-title, queue-operation, bridge-session,
// last-prompt, ...). Allowlist, never blocklist: unknown shapes are skipped.
//
// Assistant turns are split across many lines that share `message.id`; their
// content blocks must be merged in order. Tool results arrive as `user` lines
// carrying `tool_result` blocks keyed by `tool_use_id`, and attach to the tool
// call rather than rendering as a user bubble.

export type ToolState = "input-available" | "output-available" | "output-error";

export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      state: ToolState;
      output?: string;
    };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
};

type RawBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Tool results carry a string or an array of `{type:"text",text}` blocks. */
function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(isObject)
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n");
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export function parseTranscript(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // message.id -> index in `messages`, for merging split assistant turns.
  const assistantIndex = new Map<string, number>();
  // tool_use id -> the tool part awaiting its result.
  const toolParts = new Map<string, Extract<ChatPart, { kind: "tool" }>>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // partial trailing line or non-JSON; skip
    }
    if (!isObject(obj)) continue;
    const type = obj.type;
    const message = obj.message;

    if (type === "assistant" && isObject(message)) {
      const content = message.content;
      if (!Array.isArray(content)) continue;
      const mid =
        (typeof message.id === "string" && message.id) ||
        (typeof obj.uuid === "string" && obj.uuid) ||
        `a-${messages.length}`;

      let idx = assistantIndex.get(mid);
      if (idx === undefined) {
        idx = messages.length;
        messages.push({ id: mid, role: "assistant", parts: [] });
        assistantIndex.set(mid, idx);
      }
      const parts = messages[idx].parts;

      for (const block of content as RawBlock[]) {
        if (!isObject(block)) continue;
        if (block.type === "thinking" && typeof block.thinking === "string") {
          parts.push({ kind: "thinking", text: block.thinking });
        } else if (block.type === "text" && typeof block.text === "string") {
          parts.push({ kind: "text", text: block.text });
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          const part: Extract<ChatPart, { kind: "tool" }> = {
            kind: "tool",
            id: block.id,
            name: typeof block.name === "string" ? block.name : "tool",
            input: block.input,
            state: "input-available",
          };
          parts.push(part);
          toolParts.set(block.id, part);
        }
      }
      continue;
    }

    if (type === "user" && isObject(message)) {
      const content = message.content;
      if (typeof content === "string") {
        const text = content.trim();
        if (text) {
          messages.push({
            id: typeof obj.uuid === "string" ? obj.uuid : `u-${messages.length}`,
            role: "user",
            parts: [{ kind: "text", text }],
          });
        }
        continue;
      }
      if (Array.isArray(content)) {
        for (const block of content as RawBlock[]) {
          if (!isObject(block)) continue;
          if (
            block.type === "tool_result" &&
            typeof block.tool_use_id === "string"
          ) {
            const part = toolParts.get(block.tool_use_id);
            if (part) {
              part.output = stringifyToolContent(block.content);
              part.state = block.is_error ? "output-error" : "output-available";
            }
          }
        }
      }
    }
  }

  return messages;
}
