"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Size } from "./viewport/reader-geometry";

/** Measures the viewer's content box, ignoring chrome padding. */
export function useViewerSize(viewerRef: RefObject<HTMLElement | null>, resetKey: unknown) {
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const node = viewerRef.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const css = getComputedStyle(node);
        const width = Math.floor(node.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight));
        const height = Math.floor(node.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom));
        setAvailable((previous) => previous.width === width && previous.height === height
          ? previous : { width, height });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [viewerRef, resetKey]);

  return available;
}
