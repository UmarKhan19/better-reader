export type SidebarTab = "contents" | "pages" | "bookmarks" | "search";
export type ReaderPanel = "settings" | "shortcuts" | null;
export type ReaderUiState = {
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  panel: ReaderPanel;
  controlsVisible: boolean;
};
export type ReaderUiAction =
  | { type: "search" | "toggle-sidebar" | "close-sidebar" | "dismiss" | "focus" }
  | { type: "tab"; tab: SidebarTab }
  | { type: "panel"; panel: ReaderPanel }
  | { type: "controls"; visible: boolean };

export const INITIAL_READER_UI: ReaderUiState = {
  sidebarOpen: false, sidebarTab: "contents", panel: null, controlsVisible: false,
};

/** Transient UI policy only; the book session still owns the saved focus preference. */
export function readerUiReducer(state: ReaderUiState, action: ReaderUiAction): ReaderUiState {
  switch (action.type) {
    case "search": return { ...state, sidebarOpen: true, sidebarTab: "search", panel: null, controlsVisible: true };
    case "toggle-sidebar": return { ...state, sidebarOpen: !state.sidebarOpen };
    case "close-sidebar": return state.sidebarOpen ? { ...state, sidebarOpen: false } : state;
    case "tab": return { ...state, sidebarTab: action.tab };
    case "panel": return { ...state, panel: action.panel };
    case "controls": return state.controlsVisible === action.visible ? state : { ...state, controlsVisible: action.visible };
    case "dismiss": return state.panel !== null ? { ...state, panel: null }
      : state.sidebarOpen ? { ...state, sidebarOpen: false } : state;
    case "focus": return { ...state, sidebarOpen: false, panel: null, controlsVisible: false };
  }
}
