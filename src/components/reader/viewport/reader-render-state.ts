export type RasterFrame = { key: string; width: number; height: number; ratio: number };
export type RasterState = { shown: RasterFrame | null; target: RasterFrame };
export function rasterFrame(box: { fullWidth: number; fullHeight: number }, ratio: number, retry = 0): RasterFrame {
  const width = Math.max(1, Math.floor(box.fullWidth));
  const height = box.fullHeight * width / box.fullWidth;
  return { key: `${width}:${height.toFixed(5)}:${ratio.toPrecision(14)}:${retry}`, width, height, ratio };
}
export function requestRaster(state: RasterState, target: RasterFrame): RasterState {
  return state.target.key === target.key ? state : { shown: state.shown, target };
}
export function finishRaster(state: RasterState, key: string): RasterState {
  return key === state.target.key ? { ...state, shown: state.target } : state;
}

export function retainedPageWindow<T extends { page: number }>(readable: readonly T[], requested: readonly { page: number }[]) {
  return readable.filter((page) => !requested.some((next) => next.page === page.page));
}
