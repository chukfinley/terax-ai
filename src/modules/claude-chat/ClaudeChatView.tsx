import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { AiDiffPane } from "@/modules/editor/AiDiffPane";
import { writeToSession } from "@/modules/terminal";
import { ArrowUpIcon, SquareIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useRef, useState } from "react";
import { useTranscriptTail } from "./lib/useTranscriptTail";
import { diffsFromTool, teraxToolName } from "./lib/toolMap";
import type { ChatMessage, ChatPart } from "./lib/transcript";

type Props = {
  leafId: number;
  cwd: string | undefined;
  active: boolean;
};

export function ClaudeChatView({ leafId, cwd, active }: Props) {
  const { messages, status } = useTranscriptTail(cwd, active);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ChatBody messages={messages} status={status} />
      </div>
      <Composer leafId={leafId} />
    </div>
  );
}

const ChatBody = memo(function ChatBody({
  messages,
  status,
}: {
  messages: ChatMessage[];
  status: ReturnType<typeof useTranscriptTail>["status"];
}) {
  if (messages.length === 0) {
    return (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            title={
              status === "not-found"
                ? "No Claude session found"
                : "Waiting for Claude"
            }
            description={
              status === "not-found"
                ? "Start `claude` in this terminal, then switch back to Chat."
                : "Messages from the running Claude session will appear here."
            }
          />
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <Conversation>
      <ConversationContent className="gap-5 p-3">
        {messages.map((m) => (
          <RenderedMessage key={m.id} message={m} />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
});

const RenderedMessage = memo(function RenderedMessage({
  message,
}: {
  message: ChatMessage;
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p): p is Extract<ChatPart, { kind: "text" }> => p.kind === "text")
      .map((p) => p.text)
      .join("\n");
    if (!text.trim()) return null;
    return (
      <Message from="user">
        <MessageContent>
          <p className="whitespace-pre-wrap wrap-break-word">{text}</p>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      <MessageContent>
        <div className="flex flex-col gap-3">
          {message.parts.map((part, i) => (
            <RenderedPart key={`${message.id}-${i}`} part={part} />
          ))}
        </div>
      </MessageContent>
    </Message>
  );
});

const RenderedPart = memo(function RenderedPart({ part }: { part: ChatPart }) {
  if (part.kind === "text") {
    if (!part.text.trim()) return null;
    return <MessageResponse>{part.text}</MessageResponse>;
  }

  if (part.kind === "thinking") {
    if (!part.text.trim()) return null;
    return (
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
  }

  // Tool call: render file mutations through the shared diff renderer, the rest
  // through the shared Tool card.
  const diffs = diffsFromTool(part.name, part.input);
  if (diffs.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {diffs.map((d, i) => (
          <div
            key={`${part.id}-${i}`}
            className="h-[min(420px,60vh)] overflow-hidden"
          >
            <AiDiffPane
              path={d.path}
              originalContent={d.originalContent}
              proposedContent={d.proposedContent}
              status="approved"
              isNewFile={d.isNewFile}
              onAccept={noop}
              onReject={noop}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <Tool
      toolName={teraxToolName(part.name)}
      state={part.state}
      input={part.input}
      output={part.output}
      errorText={part.state === "output-error" ? part.output : undefined}
    />
  );
});

function noop() {}

const Composer = memo(function Composer({ leafId }: { leafId: number }) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    // Drive the same interactive PTY claude the terminal view talks to. The CR
    // submits the prompt exactly as if typed in the TUI.
    if (writeToSession(leafId, text + "\r")) {
      setValue("");
    }
  }, [leafId, value]);

  const interrupt = useCallback(() => {
    // ESC cancels the current turn in the claude TUI.
    writeToSession(leafId, "\x1b");
  }, [leafId]);

  return (
    <div className="shrink-0 border-t border-border/60 p-2">
      <div className="flex items-end gap-2 rounded-lg border border-border/60 bg-background px-2 py-1.5">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Message Claude…"
          className="max-h-40 min-h-[1.75rem] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          title="Interrupt (Esc)"
          onClick={interrupt}
        >
          <HugeiconsIcon icon={SquareIcon} size={15} strokeWidth={2} />
        </Button>
        <Button
          size="icon"
          className="size-7 shrink-0"
          title="Send (Enter)"
          onClick={send}
          disabled={!value.trim()}
        >
          <HugeiconsIcon icon={ArrowUpIcon} size={15} strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
});
