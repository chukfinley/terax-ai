import { create } from "zustand";

// Per-leaf terminal title, sourced from the OSC 0/2 "set window title" sequence
// the running program emits (Claude Code writes its current task here, shells
// set "user@host:cwd", etc.). Keyed by leaf id so the title survives the slot
// pool rebinding a leaf to a different renderer — we keep the last seen title
// and only overwrite it when the program emits a new (non-empty) one.
type TerminalTitleState = {
  titles: Record<number, string>;
  setTitle: (leafId: number, title: string) => void;
  clear: (leafId: number) => void;
};

export const useTerminalTitleStore = create<TerminalTitleState>((set) => ({
  titles: {},
  setTitle: (leafId, title) =>
    set((s) =>
      s.titles[leafId] === title
        ? s
        : { titles: { ...s.titles, [leafId]: title } },
    ),
  clear: (leafId) =>
    set((s) => {
      if (!(leafId in s.titles)) return s;
      const rest = { ...s.titles };
      delete rest[leafId];
      return { titles: rest };
    }),
}));
