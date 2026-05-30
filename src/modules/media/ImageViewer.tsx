import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
};

type View = { scale: number; x: number; y: number };

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_STEP = 1.15;
const CLICK_ZOOM = 2.5;
const DRAG_THRESHOLD_PX = 4;
const FIT: View = { scale: 1, x: 0, y: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Chrome-style image viewer: scroll to zoom toward the cursor, click to toggle
 * fit ↔ zoomed at the click point, drag to pan while zoomed. transform-origin
 * is the top-left of the box so cursor math stays in a single coordinate space.
 */
export function ImageViewer({ src }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);

  // Pointer drag bookkeeping. movedPx tracks total motion so a press that
  // barely moves is treated as a click (toggle) instead of a pan.
  const drag = useRef({ active: false, lastX: 0, lastY: 0, movedPx: 0 });
  const [grabbing, setGrabbing] = useState(false);

  // Reset whenever the image changes.
  useEffect(() => {
    setView(FIT);
  }, [src]);

  // Keep the panned image from drifting out of the box. With origin 0,0 the
  // scaled box width is boxW*scale, so x must stay in [boxW*(1-s), 0].
  const clampPan = useCallback((s: number, x: number, y: number): View => {
    const box = boxRef.current;
    if (!box || s <= 1) return { scale: s, x: 0, y: 0 };
    const w = box.clientWidth;
    const h = box.clientHeight;
    return {
      scale: s,
      x: clamp(x, w * (1 - s), 0),
      y: clamp(y, h * (1 - s), 0),
    };
  }, []);

  const cursorPoint = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  };

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (!boxRef.current) return;
      const { cx, cy } = cursorPoint(e);
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      setView((prev) => {
        const s = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
        if (s === prev.scale) return prev;
        if (s === 1) return FIT;
        const wx = (cx - prev.x) / prev.scale;
        const wy = (cy - prev.y) / prev.scale;
        return clampPan(s, cx - wx * s, cy - wy * s);
      });
    },
    [clampPan],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = {
      active: true,
      lastX: e.clientX,
      lastY: e.clientY,
      movedPx: 0,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d.active) return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.movedPx += Math.abs(dx) + Math.abs(dy);
      if (d.movedPx > DRAG_THRESHOLD_PX && !grabbing) setGrabbing(true);
      setView((prev) =>
        prev.scale <= 1 ? prev : clampPan(prev.scale, prev.x + dx, prev.y + dy),
      );
    },
    [clampPan, grabbing],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      d.active = false;
      setGrabbing(false);
      // A press that barely moved is a click → toggle fit ↔ zoomed.
      if (d.movedPx <= DRAG_THRESHOLD_PX && boxRef.current) {
        const { cx, cy } = cursorPoint(e);
        setView((prev) => {
          if (prev.scale > 1) return FIT;
          const wx = (cx - prev.x) / prev.scale;
          const wy = (cy - prev.y) / prev.scale;
          return clampPan(CLICK_ZOOM, cx - wx * CLICK_ZOOM, cy - wy * CLICK_ZOOM);
        });
      }
    },
    [clampPan],
  );

  const cursor =
    view.scale > 1 ? (grabbing ? "grabbing" : "grab") : "zoom-in";

  return (
    <div
      ref={boxRef}
      className="relative h-full w-full overflow-hidden"
      style={{ cursor, touchAction: "none" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-contain"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      />
    </div>
  );
}
