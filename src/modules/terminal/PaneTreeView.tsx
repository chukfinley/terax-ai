import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import type { SearchAddon } from "@xterm/addon-search";
import { Fragment } from "react";
import { useTerminalDropStore } from "./lib/dropStore";
import { firstLeafSlotId, type PaneNode } from "./lib/panes";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { useTerminalTitleStore } from "./lib/terminalTitleStore";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
  /** Called when the user finishes resizing a split. */
  onResizeSplit: (splitId: number, sizes: number[]) => void;
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    const { tabVisible, activeLeafId, blocks, onFocusLeaf, getBundle } = props;
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
            blocks={blocks}
            initialSnapshot={node.snapshot}
            ref={b.setRef}
            onSearchReady={b.onSearchReady}
            onCwd={b.onCwd}
            onExit={b.onExit}
          />
        </div>
        <DropOverlay leafId={node.id} />
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
        const raw = node.children.map(
          (child) => layout[`pane-slot-${firstLeafSlotId(child)}`],
        );
        if (raw.some((v) => typeof v !== "number")) return;
        const nums = raw as number[];
        const total = nums.reduce((s, v) => s + v, 0);
        if (total <= 0) return;
        const normalized = nums.map((v) => (v / total) * 100);
        props.onResizeSplit(node.id, normalized);
      }}
    >
      {node.children.map((child, i) => {
        const slotId = firstLeafSlotId(child);
        // defaultSize replays the persisted split ratios from the saved session.
        const size = node.sizes?.[i];
        return (
          <Fragment key={slotId}>
            {i > 0 && <ResizableHandle />}
            <ResizablePanel
              id={`pane-slot-${slotId}`}
              minSize="10%"
              defaultSize={size !== undefined ? `${size}%` : undefined}
            >
              <PaneTreeView {...props} node={child} />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
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
