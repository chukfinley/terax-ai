import {
	ArrowDown01Icon,
	ArrowRight01Icon,
	ArrowUpIcon,
	Cancel01Icon,
	SquareIcon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { AiDiffPane } from "@/modules/editor/AiDiffPane";
import { writeToSession } from "@/modules/terminal";
import { diffsFromTool, teraxToolName } from "./lib/toolMap";
import type { ChatMessage, ChatPart } from "./lib/transcript";
import { useTranscriptTail } from "./lib/useTranscriptTail";

type Props = {
	leafId: number;
	transcriptPath: string | undefined;
	active: boolean;
};

const KEY_APPROVE = "\r";
const KEY_DENY = "\x1b";

function pendingToolName(messages: ChatMessage[]): string | null {
	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant") return null;
	for (let i = last.parts.length - 1; i >= 0; i -= 1) {
		const p = last.parts[i];
		if (p.kind === "tool") {
			return p.state === "input-available" ? p.name : null;
		}
	}
	return null;
}

export function ClaudeChatView({ leafId, transcriptPath, active }: Props) {
	const { messages, status } = useTranscriptTail(transcriptPath, active);
	const agentStatus = useAgentStore((s) => s.sessions[leafId]?.status);
	const awaitingTool =
		agentStatus === "waiting" ? pendingToolName(messages) : null;
	const streaming = agentStatus === "working";

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<ChatBody
				messages={messages}
				status={status}
				streamingMessageId={
					streaming ? messages[messages.length - 1]?.id ?? null : null
				}
			/>
			{awaitingTool ? (
				<PermissionBar leafId={leafId} toolName={awaitingTool} />
			) : null}
			<Composer leafId={leafId} active={active} streaming={streaming} />
		</div>
	);
}

const PermissionBar = memo(function PermissionBar({
	leafId,
	toolName,
}: {
	leafId: number;
	toolName: string;
}) {
	const approve = useCallback(
		() => writeToSession(leafId, KEY_APPROVE),
		[leafId],
	);
	const deny = useCallback(() => writeToSession(leafId, KEY_DENY), [leafId]);

	return (
		<div className="flex shrink-0 items-center gap-2 border-t border-amber-500/40 bg-amber-500/10 px-3 py-2">
			<span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
			<span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
				Claude needs permission to run{" "}
				<span className="font-medium">{toolName}</span>
			</span>
			<Button size="sm" className="h-7 gap-1.5" onClick={approve}>
				<HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} />
				Approve
			</Button>
			<Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={deny}>
				<HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
				Deny
			</Button>
		</div>
	);
});

const ChatBody = memo(function ChatBody({
	messages,
	status,
	streamingMessageId,
}: {
	messages: ChatMessage[];
	status: ReturnType<typeof useTranscriptTail>["status"];
	streamingMessageId: string | null;
}) {
	if (messages.length === 0) {
		return (
			<Conversation className="min-h-0 flex-1">
				<ConversationContent>
					<ConversationEmptyState
						title={
							status === "live"
								? "Waiting for Claude"
								: "Type a message to begin"
						}
						description={
							status === "live"
								? "Messages from the running Claude session will appear here."
								: "Send a message below and Claude's reply will show up here."
						}
					/>
				</ConversationContent>
			</Conversation>
		);
	}

	return (
		<Conversation className="min-h-0 flex-1">
			<ConversationContent className="mx-auto w-full max-w-3xl gap-5 px-4 py-5">
				{messages.map((m) => (
					<RenderedMessage
						key={m.id}
						message={m}
						streaming={m.id === streamingMessageId}
					/>
				))}
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
});

const RenderedMessage = memo(function RenderedMessage({
	message,
	streaming,
}: {
	message: ChatMessage;
	streaming: boolean;
}) {
	if (message.role === "user") {
		const text = message.parts
			.filter(
				(p): p is Extract<ChatPart, { kind: "text" }> => p.kind === "text",
			)
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

	let lastTextIdx = -1;
	for (let i = message.parts.length - 1; i >= 0; i -= 1) {
		if (message.parts[i].kind === "text") {
			lastTextIdx = i;
			break;
		}
	}

	return (
		<Message from="assistant">
			<MessageContent>
				<div className="flex flex-col gap-3">
					{message.parts.map((part, i) => (
						<RenderedPart
							key={`${message.id}-${i}`}
							part={part}
							streaming={streaming && i === lastTextIdx}
						/>
					))}
				</div>
			</MessageContent>
		</Message>
	);
});

const RenderedPart = memo(function RenderedPart({
	part,
	streaming,
}: {
	part: ChatPart;
	streaming: boolean;
}) {
	if (part.kind === "text") {
		if (!part.text.trim()) return null;
		return <MessageResponse streaming={streaming}>{part.text}</MessageResponse>;
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

	const diffs = diffsFromTool(part.name, part.input);
	if (diffs.length > 0) {
		return (
			<div className="flex flex-col gap-2">
				{diffs.map((d, i) => (
					<LazyDiff key={`${part.id}-${i}`} diff={d} />
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

type DiffSpec = ReturnType<typeof diffsFromTool>[number];

const LazyDiff = memo(function LazyDiff({ diff }: { diff: DiffSpec }) {
	const [open, setOpen] = useState(false);
	const name = diff.path.split("/").pop() || diff.path;

	return (
		<div className="overflow-hidden rounded-md border border-border/60 bg-card/40">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-muted/50"
			>
				<HugeiconsIcon
					icon={open ? ArrowDown01Icon : ArrowRight01Icon}
					size={13}
					strokeWidth={2}
					className="shrink-0 text-muted-foreground"
				/>
				<span className="truncate font-medium">{name}</span>
				<span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{diff.isNewFile ? "new file" : "edit"}
				</span>
			</button>
			{open ? (
				<div className="h-[min(420px,60vh)] overflow-hidden border-t border-border/60">
					<AiDiffPane
						path={diff.path}
						originalContent={diff.originalContent}
						proposedContent={diff.proposedContent}
						status="approved"
						isNewFile={diff.isNewFile}
						onAccept={noop}
						onReject={noop}
					/>
				</div>
			) : null}
		</div>
	);
});

const Composer = memo(function Composer({
	leafId,
	active,
	streaming,
}: {
	leafId: number;
	active: boolean;
	streaming: boolean;
}) {
	const [value, setValue] = useState("");
	const taRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!active) return;
		const id = requestAnimationFrame(() => taRef.current?.focus());
		return () => cancelAnimationFrame(id);
	}, [active]);

	useEffect(() => {
		const el = taRef.current;
		if (!el) return;
		el.style.height = "0px";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}, [value]);

	const send = useCallback(() => {
		const text = value.trim();
		if (!text) return;
		if (writeToSession(leafId, text + "\r")) {
			setValue("");
		}
	}, [leafId, value]);

	const interrupt = useCallback(() => {
		writeToSession(leafId, "\x1b");
	}, [leafId]);

	return (
		<div className="shrink-0 border-t border-border/60 bg-background px-3 pt-2 pb-3">
			<div className="mx-auto w-full max-w-3xl">
				<div className="flex items-end gap-1.5 rounded-2xl border border-border/60 bg-card/60 px-2.5 py-2 shadow-sm focus-within:border-border focus-within:ring-1 focus-within:ring-ring/30">
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
						className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground"
					/>
					{streaming ? (
						<Button
							size="icon"
							variant="ghost"
							className="size-7 shrink-0 rounded-full"
							title="Interrupt (Esc)"
							onClick={interrupt}
						>
							<HugeiconsIcon icon={SquareIcon} size={14} strokeWidth={2} />
						</Button>
					) : (
						<Button
							size="icon"
							className="size-7 shrink-0 rounded-full"
							title="Send (Enter)"
							onClick={send}
							disabled={!value.trim()}
						>
							<HugeiconsIcon icon={ArrowUpIcon} size={14} strokeWidth={2.25} />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
});
