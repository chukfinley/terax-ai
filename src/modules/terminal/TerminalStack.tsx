import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useMemo, useRef } from "react";
import type { Tab } from "@/modules/tabs";
import { leafIds } from "./lib/panes";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";

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
		for (const t of terminals)
			for (const id of leafIds(t.paneTree)) live.add(id);
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

// One terminal tab: the live PTY pane tree. Each leaf decides on its own
// whether to show its Claude chat mirror (per-pane, so a split shows chat only
// over the pane running claude). See PaneTreeView's LeafPane.
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
	return (
		<div className="relative h-full w-full">
			<PaneTreeView
				node={tab.paneTree}
				tabVisible={tabVisible}
				activeLeafId={tab.activeLeafId}
				onFocusLeaf={(lid) => onFocusLeaf(tab.id, lid)}
				getBundle={getBundle}
			/>
		</div>
	);
}
