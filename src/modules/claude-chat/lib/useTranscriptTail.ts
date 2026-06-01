import { useEffect, useState } from "react";
import { subscribeTranscript } from "./bridge";
import { type ChatMessage, parseTranscript } from "./transcript";

export type TailState = {
	messages: ChatMessage[];
	status: "idle" | "live";
};

/**
 * While `active` and given the exact transcript `path` (learned from the Claude
 * Code hooks, never guessed), stream that session's JSONL into parsed chat
 * messages. Re-parses the full accumulated text on each chunk: transcripts are
 * small, and merging split assistant turns needs the whole stream. Tears down
 * the backend tail when inactive or when the path changes.
 *
 * No path means we don't yet know which of the project's many sibling sessions
 * is this one (e.g. a fresh session before its first prompt). We stay idle and
 * show nothing rather than mirror the wrong session.
 */
export function useTranscriptTail(
	path: string | undefined,
	active: boolean,
): TailState {
	const [state, setState] = useState<TailState>({
		messages: [],
		status: "idle",
	});

	useEffect(() => {
		if (!active || !path) {
			setState({ messages: [], status: "idle" });
			return;
		}

		let cancelled = false;
		let raw = "";
		let sub: { close: () => void } | null = null;
		setState({ messages: [], status: "live" });

		(async () => {
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
	}, [path, active]);

	return state;
}
