import { clampOffset, clampPage, type ReadingLocation } from "@/lib/reading-progress";

export const LOCATION_HISTORY_LIMIT = 32;
export type ReaderNavigationState = {
  location: ReadingLocation;
  navigation: ReadingLocation & { revision: number };
  history: ReadingLocation[];
};
export type ReaderNavigationAction =
  | { type: "scroll"; location: ReadingLocation; pageCount: number }
  | { type: "jump"; location: ReadingLocation; pageCount: number; remember?: boolean }
  | { type: "restore"; pageCount: number }
  | { type: "back"; pageCount: number };

export function initialNavigation(location: ReadingLocation): ReaderNavigationState {
  return { location, navigation: { ...location, revision: 0 }, history: [] };
}

function sameLocation(a: ReadingLocation, b: ReadingLocation) {
  return a.page === b.page && a.offset === b.offset;
}

export function readerNavigationReducer(state: ReaderNavigationState, action: ReaderNavigationAction): ReaderNavigationState {
  if (action.type === "back" && state.history.length === 0) return state;
  const requested = action.type === "back" ? state.history[state.history.length - 1]
    : action.type === "restore" ? state.location : action.location;
  const location = { page: clampPage(requested.page, action.pageCount), offset: clampOffset(requested.offset) };
  if (action.type === "scroll") {
    return sameLocation(location, state.location) ? state : { ...state, location };
  }
  let history = state.history;
  if (action.type === "back") history = history.slice(0, -1);
  else if (action.type === "jump" && action.remember && !sameLocation(location, state.location)) {
    history = [...history.filter((entry, index) => index !== history.length - 1 || !sameLocation(entry, state.location)), state.location]
      .slice(-LOCATION_HISTORY_LIMIT);
  }
  return { location, history, navigation: { ...location, revision: state.navigation.revision + 1 } };
}
