import { Channel, invoke } from "@tauri-apps/api/core";

/** Newest transcript JSONL for `claude` running in `cwd`, or null if none. */
export function findTranscript(cwd: string): Promise<string | null> {
  return invoke<string | null>("claude_find_transcript", { cwd });
}

export type TranscriptSubscription = {
  close: () => void;
};

/**
 * Tail a transcript file. `onChunk` receives the existing content first, then
 * appended whole lines as the live `claude` writes them. Caller must `close()`
 * to stop the backend tail when leaving chat mode.
 */
export async function subscribeTranscript(
  path: string,
  onChunk: (text: string) => void,
): Promise<TranscriptSubscription> {
  const channel = new Channel<string>();
  channel.onmessage = onChunk;
  await invoke("claude_transcript_subscribe", { path, onChunk: channel });
  let closed = false;
  return {
    close: () => {
      if (closed) return;
      closed = true;
      void invoke("claude_transcript_unsubscribe", { path }).catch(() => {});
    },
  };
}
