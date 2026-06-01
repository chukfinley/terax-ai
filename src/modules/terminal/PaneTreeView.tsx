import { BubbleChatIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { ClaudeChatView } from "@/modules/claude-chat/ClaudeChatView";
import { useChatViewStore } from "@/modules/claude-chat/store/chatViewStore";
import type { PaneNode } from "./lib/panes";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
	setRef: (h: TerminalPaneHandle | null) => void;
	onSearch: (addon: SearchAddon) => void;
	onCwd: (cwd: string) => void;
	onExit: (code: number) => void;
};

type Props = {
	node: PaneNode;
	tabVisible: boolean;
	activeLeafId: number;
	onFocusLeaf: (leafId: number) => void;
	getBundle: (leafId: number) => LeafBundle;
};

export function PaneTreeView({
	node,
	tabVisible,
	activeLeafId,
	onFocusLeaf,
	getBundle,
}: Props) {
	if (node.kind === "leaf") {
		const focused = node.id === activeLeafId;
		return (
			<LeafPane
				node={node}
				focused={focused}
				tabVisible={tabVisible}
				onFocusLeaf={onFocusLeaf}
				getBundle={getBundle}
			/>
		);
	}

	return (
		<ResizablePanelGroup
			orientation={node.dir === "row" ? "horizontal" : "vertical"}
		>
			{node.children.map((child, i) => (
				<Fragment key={child.id}>
					{i > 0 && <ResizableHandle />}
					<ResizablePanel id={`pane-${child.id}`} minSize="10%">
						<PaneTreeView
							node={child}
							tabVisible={tabVisible}
							activeLeafId={activeLeafId}
							onFocusLeaf={onFocusLeaf}
							getBundle={getBundle}
						/>
					</ResizablePanel>
				</Fragment>
			))}
		</ResizablePanelGroup>
	);
}

// One leaf: the live PTY pane plus, when a claude agent is detected for it, an
// optional chat mirror overlaid on top. The chat lives per-leaf (not per-tab)
// so a split shows the chat only over the pane running claude; the sibling pane
// stays a normal terminal. The PTY is never unmounted — switching is a CSS flip
// — so the running agent survives the toggle.
function LeafPane({
	node,
	focused,
	tabVisible,
	onFocusLeaf,
	getBundle,
}: {
	node: Extract<PaneNode, { kind: "leaf" }>;
	focused: boolean;
	tabVisible: boolean;
	onFocusLeaf: (leafId: number) => void;
	getBundle: (leafId: number) => LeafBundle;
}) {
	const leafId = node.id;
	const b = getBundle(leafId);
	const session = useAgentStore((s) => s.sessions[leafId]);
	const hasAgent = !!session;
	const mode = useChatViewStore((s) => s.modes[leafId] ?? "terminal");
	const setMode = useChatViewStore((s) => s.setMode);
	const chatActive = mode === "chat" && hasAgent;
	// When the chat face is up, the terminal must NOT keep grabbing DOM focus —
	// otherwise xterm's hidden textarea steals it back and the composer can't be
	// typed into. So the PTY pane is told it is unfocused while chat is showing.
	const terminalFocused = focused && !chatActive;

	return (
		<div
			onMouseDownCapture={() => {
				if (!focused) onFocusLeaf(leafId);
			}}
			// Catches focus from Tab, programmatic focus, or any path that
			// skips mousedown — keeps activeLeafId in sync with DOM focus.
			onFocus={() => {
				if (!focused) onFocusLeaf(leafId);
			}}
			data-pane-leaf={leafId}
			className="relative flex h-full w-full flex-col"
		>
			{hasAgent ? (
				<ChatModeBar
					leafId={leafId}
					focused={focused}
					mode={mode}
					onSetMode={(m) => setMode(leafId, m)}
				/>
			) : null}
			<div className="relative min-h-0 w-full flex-1">
				<TerminalPane
					leafId={leafId}
					visible={tabVisible}
					focused={terminalFocused}
					initialCwd={node.cwd}
					ref={b.setRef}
					onSearchReady={(_id, addon) => b.onSearch(addon)}
					onCwd={(_id, cwd) => b.onCwd(cwd)}
					onExit={(_id, code) => b.onExit(code)}
				/>
				{hasAgent ? (
					<div
						className={cn(
							"absolute inset-0 bg-background",
							chatActive ? "" : "invisible pointer-events-none",
						)}
						aria-hidden={!chatActive}
					>
						<ClaudeChatView
							leafId={leafId}
							transcriptPath={session?.transcriptPath ?? undefined}
							active={chatActive && tabVisible}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}

// Header strip for a pane running a coding agent: a Terminal/Chat segmented
// toggle plus a live status pill (working/waiting) so the chat face mirrors the
// TUI's "crunching..." state. Sits ABOVE the content, never floating over the
// first chat message.
function ChatModeBar({
	leafId,
	focused,
	mode,
	onSetMode,
}: {
	leafId: number;
	focused: boolean;
	mode: "terminal" | "chat";
	onSetMode: (mode: "terminal" | "chat") => void;
}) {
	const status = useAgentStore((s) => s.sessions[leafId]?.status);

	return (
		<div
			className={cn(
				"flex h-[26px] shrink-0 select-none items-center gap-2 border-b px-2",
				focused ? "border-border bg-muted" : "border-border/60 bg-background",
			)}
		>
			{status ? (
				<span className="flex shrink-0 items-center gap-1.5">
					<span
						className={cn(
							"size-1.5 rounded-full",
							status === "working"
								? "animate-pulse bg-amber-500"
								: "bg-sky-500",
						)}
					/>
					<span
						className={cn(
							"text-[10px] font-medium tracking-tight",
							status === "working" ? "text-amber-500" : "text-sky-500",
						)}
					>
						{status === "working" ? "Working" : "Waiting"}
					</span>
				</span>
			) : null}
			<span className="flex-1" />
			<div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 bg-background/90 p-0.5">
				<Button
					size="icon"
					variant={mode === "terminal" ? "secondary" : "ghost"}
					className="size-5"
					title="Terminal view"
					onClick={() => onSetMode("terminal")}
				>
					<HugeiconsIcon icon={TerminalIcon} size={12} strokeWidth={2} />
				</Button>
				<Button
					size="icon"
					variant={mode === "chat" ? "secondary" : "ghost"}
					className="size-5"
					title="Chat view"
					onClick={() => onSetMode("chat")}
				>
					<HugeiconsIcon icon={BubbleChatIcon} size={12} strokeWidth={2} />
				</Button>
			</div>
		</div>
	);
}
