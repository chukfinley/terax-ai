import { useEffect, useState } from "react";
import { findTranscript, subscribeTranscript } from "./bridge";
import { parseTranscript, type ChatMessage } from "./transcript";

export type TailState = {
  messages: ChatMessage[];
  status: "idle" | "searching" | "live" | "not-found";
};

/**
 * While `active`, locate the transcript for the claude session running in `cwd`
 * and stream it into parsed chat messages. Re-parses the full accumulated text
 * on each chunk (transcripts are small enough; merging split assistant turns
 * needs the whole stream). Tears down the backend tail when inactive.
 */
export function useTranscriptTail(cwd: string | undefined, active: boolean): TailState {
  const [state, setState] = useState<TailState>({ messages: [], status: "idle" });

  useEffect(() => {
    if (!active || !cwd) {
      setState({ messages: [], status: "idle" });
      return;
    }

    let cancelled = false;
    let raw = "";
    let sub: { close: () => void } | null = null;
    setState({ messages: [], status: "searching" });

    (async () => {
      const path = await findTranscript(cwd).catch(() => null);
      if (cancelled) return;
      if (!path) {
        setState({ messages: [], status: "not-found" });
        return;
      }
      sub = await subscribeTranscript(path, (chunk) => {
        if (cancelled) return;
        raw += chunk;
        setState({ messages: parseTranscript(raw), status: "live" });
      }).catch(() => null);
      if (cancelled) sub?.close();
    })();

    return () => {
      cancelled = true;
      sub?.close();
    };
  }, [cwd, active]);

  return state;
}
