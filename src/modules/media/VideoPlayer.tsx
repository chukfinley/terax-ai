import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  mime: string;
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function label(rate: number): string {
  return `${rate}×`;
}

export function VideoPlayer({ src, mime }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useState(1);

  // Keep the element's playbackRate in sync — the native settings menu is
  // unreliable on WebKitGTK, so this is the source of truth. Re-applied on
  // load because some backends reset the rate when new media is attached.
  const applyRate = useCallback((r: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
  }, []);

  useEffect(() => {
    applyRate(rate);
  }, [rate, src, applyRate]);

  const changeRate = (value: string) => {
    const r = Number(value);
    setRate(r);
    applyRate(r);
  };

  return (
    <div
      className="relative flex h-full w-full items-center justify-center"
      // Suppress the webview's default right-click menu, which looks out of
      // place against the app's own UI.
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={() => applyRate(rate)}
        className="max-h-full max-w-full object-contain block"
      >
        <source src={src} type={mime} />
      </video>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute right-3 top-3 rounded-md border border-border/60 bg-card/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-md hover:bg-accent"
          title="Playback speed"
        >
          {label(rate)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-24">
          <DropdownMenuRadioGroup
            value={String(rate)}
            onValueChange={changeRate}
          >
            {SPEEDS.map((s) => (
              <DropdownMenuRadioItem key={s} value={String(s)}>
                {label(s)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
