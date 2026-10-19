"use client";

import styles from "./reader-chrome.module.css";

export function KeyboardShortcuts() {
  const shortcuts = [
    ["← / →", "Previous / next page"],
    ["Page Up / Page Down", "Previous / next page"],
    ["+ / −", "Zoom in / out"],
    ["0", "Fit width"],
    ["1", "Actual size"],
    ["T", "Open document navigation"],
    ["/ or Ctrl / ⌘ + F", "Search this document"],
    ["Alt + ←", "Back to previous location"],
    ["B", "Bookmark this page"],
    ["Z", "Toggle focus mode"],
    ["F", "Toggle fullscreen"],
    ["Esc", "Close a panel or exit focus mode"],
    ["?", "Keyboard shortcuts"],
  ];
  return <dl className={styles.shortcutList}>{shortcuts.map(([keys, action]) => (
    <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>
  ))}</dl>;
}
