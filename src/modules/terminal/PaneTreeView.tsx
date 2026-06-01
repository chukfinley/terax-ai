import { Fragment } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import type { SearchAddon } from "@xterm/addon-search";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { useTerminalTitleStore } from "./lib/terminalTitleStore";
import type { PaneNode } from "./lib/panes";

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
  /** Called when the user finishes resizing a split. */
  onResizeSplit: (splitId: number, sizes: number[]) => void;
};

export function PaneTreeView({
  node,
  tabVisible,
  activeLeafId,
  onFocusLeaf,
  getBundle,
  onResizeSplit,
}: Props) {
  if (node.kind === "leaf") {
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    return (
      <div
        onMouseDownCapture={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        // Catches focus from Tab, programmatic focus, or any path that
        // skips mousedown — keeps activeLeafId in sync with DOM focus.
        onFocus={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        data-pane-leaf={node.id}
        className="relative flex h-full w-full flex-col"
      >
        <LeafTitleBar leafId={node.id} focused={focused} />
        <div className="relative min-h-0 w-full flex-1">
          <TerminalPane
            leafId={node.id}
            visible={tabVisible}
            focused={focused}
            initialCwd={node.cwd}
            initialSnapshot={node.snapshot}
            ref={b.setRef}
            onSearchReady={(_id, addon) => b.onSearch(addon)}
            onCwd={(_id, cwd) => b.onCwd(cwd)}
            onExit={(_id, code) => b.onExit(code)}
          />
        </div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
      onLayoutChanged={(layout) => {
        // If any panel is missing from the layout map (e.g. the group hasn't
        // settled yet), bail rather than corrupting the stored sizes — a zero
        // entry would render the pane at 0% on next restore.
        const raw = node.children.map((child) => layout[`pane-${child.id}`]);
        if (raw.some((v) => typeof v !== "number")) return;
        const nums = raw as number[];
        const total = nums.reduce((s, v) => s + v, 0);
        if (total <= 0) return;
        const normalized = nums.map((v) => (v / total) * 100);
        onResizeSplit(node.id, normalized);
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizableHandle />}
          <ResizablePanel
            id={`pane-${child.id}`}
            minSize="10%"
            defaultSize={node.sizes?.[i] !== undefined ? `${node.sizes[i]}%` : undefined}
          >
            <PaneTreeView
              node={child}
              tabVisible={tabVisible}
              activeLeafId={activeLeafId}
              onFocusLeaf={onFocusLeaf}
              getBundle={getBundle}
              onResizeSplit={onResizeSplit}
            />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

// Thin header strip above each terminal pane showing its OSC window title (the
// running program's self-reported label, e.g. a Claude Code session's current
// task). Lets the user tell apart several split panes at a glance. Renders
// nothing until a title arrives, so a plain shell that sets none stays clean.
function LeafTitleBar({ leafId, focused }: { leafId: number; focused: boolean }) {
  const title = useTerminalTitleStore((s) => s.titles[leafId]);
  if (!title) return null;
  return (
    <div
      title={title}
      className={cn(
        // Opaque background so the terminal never shows through — the strip
        // eats a sliver of height at the top, it does not float over the text.
        "flex h-[18px] shrink-0 select-none items-center truncate border-b px-2 text-[10px] font-medium leading-none tracking-tight",
        focused
          ? "border-border bg-muted text-foreground/90"
          : "border-border/60 bg-background text-muted-foreground",
      )}
    >
      <span className="truncate">{title}</span>
    </div>
  );
}
