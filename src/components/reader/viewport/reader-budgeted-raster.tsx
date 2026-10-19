"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ScheduledPdfPage, type ScheduledPdfPageProps } from "./reader-render-queue";
import { ReaderRasterBudget, rasterPixels, type RasterReservation } from "./reader-raster-budget";
import type { RasterFrame } from "./reader-render-state";

export function BudgetedRaster({ frame, budget, retained, onPromoted, ...props }: ScheduledPdfPageProps & {
  frame: RasterFrame; budget: ReaderRasterBudget; retained: boolean; onPromoted: () => void;
}) {
  const [permitted, setPermitted] = useState(false);
  const reservation = useRef<RasterReservation | null>(null);
  const promote = useEffectEvent(onPromoted);
  useEffect(() => {
    const ticket = budget.reserve(props.pageNumber!, rasterPixels(frame, frame.ratio), props.priority, retained,
      () => setPermitted(true), () => promote());
    reservation.current = ticket;
    return () => { ticket.cancel(); reservation.current = null; };
    // Priority/presentation update the live reservation without losing its canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, props.pageNumber, frame.key]);
  useEffect(() => { reservation.current?.update(props.priority, retained); }, [props.priority, retained]);
  const rendered = useCallback(() => reservation.current?.ready(), []);
  return permitted ? <ScheduledPdfPage {...props} onRenderSuccess={rendered} /> : null;
}
