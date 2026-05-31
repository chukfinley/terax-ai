import { describe, expect, it } from "vitest";
import { parseTranscript, type ChatMessage } from "./transcript";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("parseTranscript", () => {
  it("ignores meta line types", () => {
    const raw = [
      line({ type: "mode", mode: "x", sessionId: "s" }),
      line({ type: "permission-mode", permissionMode: "default" }),
      line({ type: "file-history-snapshot", messageId: "m" }),
      line({ type: "ai-title", aiTitle: "t" }),
    ].join("\n");
    expect(parseTranscript(raw)).toEqual([]);
  });

  it("renders a user string prompt as a bubble", () => {
    const raw = line({
      type: "user",
      uuid: "u1",
      message: { role: "user", content: "hello there" },
    });
    expect(parseTranscript(raw)).toEqual<ChatMessage[]>([
      { id: "u1", role: "user", parts: [{ kind: "text", text: "hello there" }] },
    ]);
  });

  it("merges assistant lines sharing message.id in order", () => {
    const raw = [
      line({
        type: "assistant",
        uuid: "a1",
        message: {
          id: "msg_1",
          role: "assistant",
          content: [{ type: "thinking", thinking: "hmm", signature: "x" }],
        },
      }),
      line({
        type: "assistant",
        uuid: "a2",
        message: {
          id: "msg_1",
          role: "assistant",
          content: [{ type: "text", text: "answer" }],
        },
      }),
    ].join("\n");
    const out = parseTranscript(raw);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("msg_1");
    expect(out[0].parts).toEqual([
      { kind: "thinking", text: "hmm" },
      { kind: "text", text: "answer" },
    ]);
  });

  it("attaches tool_result to the tool_use, no user bubble", () => {
    const raw = [
      line({
        type: "assistant",
        message: {
          id: "msg_1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "Bash",
              input: { command: "ls", description: "list" },
            },
          ],
        },
      }),
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: "a\nb" },
          ],
        },
      }),
    ].join("\n");
    const out = parseTranscript(raw);
    expect(out).toHaveLength(1);
    const tool = out[0].parts[0];
    expect(tool).toMatchObject({
      kind: "tool",
      name: "Bash",
      state: "output-available",
      output: "a\nb",
    });
  });

  it("marks errored tool results", () => {
    const raw = [
      line({
        type: "assistant",
        message: {
          id: "m",
          role: "assistant",
          content: [{ type: "tool_use", id: "t", name: "Edit", input: {} }],
        },
      }),
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t",
              content: "boom",
              is_error: true,
            },
          ],
        },
      }),
    ].join("\n");
    const tool = parseTranscript(raw)[0].parts[0];
    expect(tool).toMatchObject({ state: "output-error", output: "boom" });
  });

  it("flattens array tool_result content into text", () => {
    const raw = [
      line({
        type: "assistant",
        message: {
          id: "m",
          role: "assistant",
          content: [{ type: "tool_use", id: "t", name: "Read", input: {} }],
        },
      }),
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t",
              content: [{ type: "text", text: "file body" }],
            },
          ],
        },
      }),
    ].join("\n");
    const tool = parseTranscript(raw)[0].parts[0] as Extract<
      ChatMessage["parts"][number],
      { kind: "tool" }
    >;
    expect(tool.output).toBe("file body");
  });

  it("tolerates a partial trailing line", () => {
    const raw =
      line({
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "hi" },
      }) + '\n{"type":"assist';
    const out = parseTranscript(raw);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });

  it("leaves a pending tool call as input-available until its result", () => {
    const raw = line({
      type: "assistant",
      message: {
        id: "m",
        role: "assistant",
        content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }],
      },
    });
    const tool = parseTranscript(raw)[0].parts[0];
    expect(tool).toMatchObject({ kind: "tool", state: "input-available" });
  });
});
