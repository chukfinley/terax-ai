import { create } from "zustand";

export type ViewMode = "terminal" | "chat";

// Per-leaf transient UI state: which face (raw terminal vs chat GUI) a terminal
// pane currently shows. Not persisted — defaults to terminal on restore so a
// reopened window never hides a live PTY behind a stale chat view.
type ChatViewState = {
  modes: Record<number, ViewMode>;
  setMode: (leafId: number, mode: ViewMode) => void;
  toggle: (leafId: number) => void;
  clear: (leafId: number) => void;
};

export const useChatViewStore = create<ChatViewState>((set) => ({
  modes: {},
  setMode: (leafId, mode) =>
    set((s) => ({ modes: { ...s.modes, [leafId]: mode } })),
  toggle: (leafId) =>
    set((s) => ({
      modes: {
        ...s.modes,
        [leafId]: s.modes[leafId] === "chat" ? "terminal" : "chat",
      },
    })),
  clear: (leafId) =>
    set((s) => {
      if (!(leafId in s.modes)) return s;
      const rest = { ...s.modes };
      delete rest[leafId];
      return { modes: rest };
    }),
}));
