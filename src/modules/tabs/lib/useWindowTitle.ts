import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { findLeafCwd } from "@/modules/terminal/lib/panes";
import { useTerminalTitleStore } from "@/modules/terminal/lib/terminalTitleStore";
import type { Tab } from "./useTabs";

const APP_NAME = "Terax";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/** Label of the focused tab — for terminals, the active pane's folder. */
function tabLabel(tab: Tab | undefined): string {
  if (!tab) return "";
  if (tab.kind === "terminal") {
    const cwd = findLeafCwd(tab.paneTree, tab.activeLeafId) ?? tab.cwd;
    return cwd ? basename(cwd) : tab.title;
  }
  return tab.title;
}

/**
 * Drives the OS window title from the focused tab + project folder, the way
 * Spotify shows the current track instead of just the app name. Without this
 * the window keeps the build-time default ("Tauri App" on Linux).
 *
 * Format: `<project> — <label>` (e.g. `terax-ai — Fixed Train Positioning`),
 * where the label prefers the active terminal's OSC window title (a Claude Code
 * session's current task, etc.) and falls back to the pane's folder. Collapses
 * to just the project when the label matches it, and to the app name when
 * there's nothing to show.
 */
export function useWindowTitle(
  activeTab: Tab | undefined,
  explorerRoot: string | null,
): void {
  const project = explorerRoot ? basename(explorerRoot) : "";
  // Prefer the focused terminal's self-reported title; fall back to its folder.
  const leafTitle = useTerminalTitleStore((s) =>
    activeTab?.kind === "terminal" ? s.titles[activeTab.activeLeafId] : undefined,
  );
  const label = leafTitle ?? tabLabel(activeTab);

  useEffect(() => {
    let title: string;
    if (project && label && label !== project) title = `${project} — ${label}`;
    else title = project || label || APP_NAME;

    document.title = title;
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
  }, [project, label]);
}
