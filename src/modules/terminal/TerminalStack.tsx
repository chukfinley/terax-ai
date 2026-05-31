import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { ClaudeChatView } from "@/modules/claude-chat/ClaudeChatView";
import { useChatViewStore } from "@/modules/claude-chat/store/chatViewStore";
import type { Tab } from "@/modules/tabs";
import { BubbleChatIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useMemo, useRef } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { findLeafCwd, leafIds } from "./lib/panes";

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Register/unregister handle by leaf id (not tab id). */
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
};

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
}: Props) {
  const terminals = useMemo(
    () => tabs.filter((t) => t.kind === "terminal"),
    [tabs],
  );

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    searchReadyRef.current = onSearchReady;
  }, [onSearchReady]);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearch: (addon) => searchReadyRef.current(leafId, addon),
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onExit: (code) => exitRef.current(leafId, code),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  };

  useEffect(() => {
    const live = new Set<number>();
    for (const t of terminals) for (const id of leafIds(t.paneTree)) live.add(id);
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
  }, [terminals]);

  return (
    <div className="relative h-full w-full">
      {terminals.map((t) => {
        const tabVisible = t.id === activeId;
        return (
          <div
            key={t.id}
            className="absolute inset-0"
            style={{
              visibility: tabVisible ? "visible" : "hidden",
              pointerEvents: tabVisible ? "auto" : "none",
            }}
            aria-hidden={!tabVisible}
          >
            <TerminalTabBody
              tab={t}
              tabVisible={tabVisible}
              onFocusLeaf={onFocusLeaf}
              getBundle={getBundle}
            />
          </div>
        );
      })}
    </div>
  );
}

// One terminal tab: the live PTY pane tree, plus a Claude chat mirror overlaid
// on top when chat mode is on for the tab's active leaf. The PTY tree stays
// mounted underneath (hidden, not unmounted) so the running agent is never
// killed by a view switch.
function TerminalTabBody({
  tab,
  tabVisible,
  onFocusLeaf,
  getBundle,
}: {
  tab: Extract<Tab, { kind: "terminal" }>;
  tabVisible: boolean;
  onFocusLeaf: (tabId: number, leafId: number) => void;
  getBundle: (leafId: number) => Bundle;
}) {
  const leafId = tab.activeLeafId;
  const mode = useChatViewStore((s) => s.modes[leafId] ?? "terminal");
  const toggle = useChatViewStore((s) => s.toggle);
  // Only offer chat mode once a coding agent (claude) is detected in this tab.
  const hasAgent = useAgentStore((s) =>
    Object.values(s.sessions).some((sess) => sess.tabId === tab.id),
  );
  const chatActive = mode === "chat" && hasAgent;
  const cwd = findLeafCwd(tab.paneTree, leafId) ?? tab.cwd;

  return (
    <div className="relative h-full w-full">
      <PaneTreeView
        node={tab.paneTree}
        tabVisible={tabVisible}
        activeLeafId={tab.activeLeafId}
        onFocusLeaf={(lid) => onFocusLeaf(tab.id, lid)}
        getBundle={getBundle}
      />

      <div
        className={cn(
          "absolute inset-0 bg-background",
          chatActive ? "" : "invisible pointer-events-none",
        )}
        aria-hidden={!chatActive}
      >
        <ClaudeChatView leafId={leafId} cwd={cwd} active={chatActive && tabVisible} />
      </div>

      {hasAgent ? (
        <div className="absolute right-3 top-2 z-10 flex items-center gap-0.5 rounded-md border border-border/60 bg-background/90 p-0.5 shadow-sm backdrop-blur">
          <Button
            size="icon"
            variant={mode === "terminal" ? "secondary" : "ghost"}
            className="size-6"
            title="Terminal view"
            onClick={() => mode !== "terminal" && toggle(leafId)}
          >
            <HugeiconsIcon icon={TerminalIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            size="icon"
            variant={mode === "chat" ? "secondary" : "ghost"}
            className="size-6"
            title="Chat view"
            onClick={() => mode !== "chat" && toggle(leafId)}
          >
            <HugeiconsIcon icon={BubbleChatIcon} size={13} strokeWidth={2} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
