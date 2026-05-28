import type { EditorPaneHandle } from "./types";

/** No-op stubs so media tabs satisfy `EditorPaneHandle` for search/editor callers. */
export function createMediaEditorHandle(
  path: string,
  reload: () => void,
): EditorPaneHandle {
  return {
    setQuery: () => {},
    findNext: () => {},
    findPrevious: () => {},
    clearQuery: () => {},
    focus: () => {},
    getSelection: () => null,
    getPath: () => path,
    reload: () => {
      reload();
      return true;
    },
    undo: () => {},
    redo: () => {},
  };
}
