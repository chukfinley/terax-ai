import { getMediaKind, mimeForMediaKind } from "@/lib/mediaPath";
import { resolveMediaUrl } from "@/lib/mediaSrc";
import { createMediaEditorHandle } from "@/modules/editor/mediaEditorHandle";
import { ImageViewer } from "@/modules/media/ImageViewer";
import { VideoPlayer } from "@/modules/media/VideoPlayer";
import type { EditorPaneHandle } from "@/modules/editor/types";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; src: string; size: number; revoke?: () => void }
  | { kind: "error"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type Props = {
  path: string;
};

export const MediaPreview = forwardRef<EditorPaneHandle, Props>(
  function MediaPreview({ path }, ref) {
    const mediaKind = getMediaKind(path);
    const [status, setStatus] = useState<Status>({ kind: "loading" });
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
      if (!mediaKind) return;
      let cancelled = false;
      let revoke: (() => void) | undefined;
      setStatus({ kind: "loading" });

      void resolveMediaUrl(path, mediaKind)
        .then(({ src, size, revoke: r }) => {
          if (cancelled) {
            r?.();
            return;
          }
          revoke = r;
          setStatus({ kind: "ready", src, size, revoke: r });
        })
        .catch((e) => {
          if (!cancelled) {
            setStatus({ kind: "error", message: String(e) });
          }
        });

      return () => {
        cancelled = true;
        revoke?.();
      };
    }, [path, mediaKind, reloadKey]);

    useImperativeHandle(
      ref,
      () =>
        createMediaEditorHandle(path, () => {
          setReloadKey((k) => k + 1);
        }),
      [path],
    );

    if (!mediaKind) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
          Unsupported media type
        </div>
      );
    }

    if (status.kind === "loading") {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      );
    }

    if (status.kind === "error") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
          {status.message}
        </div>
      );
    }

    const mime = mimeForMediaKind(mediaKind, path);

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="truncate font-mono">{path.split(/[\\/]/).pop()}</span>
          <span>{formatBytes(status.size)}</span>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/20 p-4 flex items-center justify-center">
          {mediaKind === "image" ? (
            <ImageViewer src={status.src} />
          ) : mediaKind === "video" ? (
            <VideoPlayer src={status.src} mime={mime} />
          ) : (
            <div className="w-full max-w-md">
              <audio src={status.src} controls className="w-full">
                <source src={status.src} type={mime} />
              </audio>
            </div>
          )}
        </div>
      </div>
    );
  },
);
