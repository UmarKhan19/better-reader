"use client";

import { Button } from "@/components/ui/button";
import { Focus, Keyboard, Laptop, Maximize, Minimize, Moon, Sun, ZoomIn, ZoomOut } from "lucide-react";
import { RadioChoices, ReaderDialog } from "./reader-controls";
import styles from "../reader.module.css";
import type { ReaderLayout, ReaderPreferences, ViewMode } from "../reader-preferences";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { THEME_STORAGE_KEY, type Theme } from "@/components/theme";
import { markStorageResult } from "@/lib/storage-health";

export type ReaderSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  preferences: ReaderPreferences;
  updatePreferences: (update: Partial<ReaderPreferences>) => void;
  pdf: PDFDocumentProxy | null;
  effectiveScale: number;
  zoomBy: (delta: number) => void;
  theme: Theme;
  setTheme: (value: Theme) => boolean;
  focusMode: boolean;
  toggleFocus: () => void;
  fullscreenSupported: boolean;
  isFullscreen: boolean;
  toggleFullscreen: () => void | Promise<void>;
  onOpenShortcuts: () => void;
  storageBlocked: boolean;
};

export function ReaderSettingsDialog(props: ReaderSettingsDialogProps) {
  const {
    open, onClose, preferences, updatePreferences, pdf, effectiveScale, zoomBy, theme, setTheme,
    focusMode, toggleFocus, fullscreenSupported, isFullscreen, toggleFullscreen, onOpenShortcuts, storageBlocked,
  } = props;
  return (
    <ReaderDialog open={open} title="Reading settings" onClose={onClose}>
      <div className={styles.settings}>
        <div className={styles.settingsSection}>
          <label className={styles.settingGroup}>
            <span>Reading layout</span>
            <select value={preferences.layout} onChange={(event) => updatePreferences({ layout: event.target.value as ReaderLayout })}>
              <option value="continuous">Continuous scroll</option><option value="single">Single page</option>
              <option value="spread">Two-page spread</option>
            </select>
          </label>
          <p className={styles.settingsNote}>Two-page spread uses continuous scroll on narrow screens. {storageBlocked ? "This choice can't be saved on this device right now." : "Your layout choice stays saved."}</p>
          <label className={styles.toggleSetting}>
            <span>Fit content <small>Hide blank margins without changing the PDF.</small></span>
            <input type="checkbox" role="switch" checked={preferences.cropMargins}
              onChange={(event) => updatePreferences({ cropMargins: event.target.checked })} />
          </label>
          <div className={styles.sizingSettings}>
            <label className={styles.settingGroup}>
              <span>Page sizing</span>
              <select value={preferences.viewMode} onChange={(event) => updatePreferences({ viewMode: event.target.value as ViewMode })}>
                <option value="fit-width">Fit width</option><option value="fit-page">Fit page</option>
                <option value="actual-size">Actual size · 100%</option><option value="custom">Custom zoom</option>
              </select>
            </label>
            <div className={styles.settingGroup}>
              <span>Zoom</span>
              <div className={styles.zoomControls}>
                <Button variant="ghost" size="icon-touch" aria-label="Zoom out" disabled={!pdf} onClick={() => zoomBy(-0.1)}><ZoomOut /></Button>
                <output aria-label="Zoom level">{Math.round((preferences.viewMode === "custom" ? preferences.zoom : effectiveScale) * 100)}%</output>
                <Button variant="ghost" size="icon-touch" aria-label="Zoom in" disabled={!pdf} onClick={() => zoomBy(0.1)}><ZoomIn /></Button>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.settingsSection}>
          <RadioChoices legend="Interface theme" value={theme}
            onChange={(value) => { markStorageResult(THEME_STORAGE_KEY, setTheme(value)); }}
            options={[{ value: "system", label: "System", icon: <Laptop /> }, { value: "light", label: "Light", icon: <Sun /> }, { value: "dark", label: "Dark", icon: <Moon /> }]} />
          <p className={styles.settingsNote}>The theme applies to your library and every book.{storageBlocked && " It won't survive a reload until browser storage works again."}</p>
          <RadioChoices legend="Paper" presentation="paper" value={preferences.paper} onChange={(paper) => updatePreferences({ paper })}
            options={[{ value: "original", label: "Original" }, { value: "dimmed", label: "Dimmed" }, { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" }]} />
          <p className={styles.settingsNote}>Paper modes change brightness, warmth, or contrast. Dark mode recolors the whole page, including diagrams and images. {storageBlocked ? "This setting can't be saved on this device right now." : "These settings are saved for this book."}</p>
        </div>
        <div className={styles.settingsSection}>
          <div className={styles.settingsActions}>
            <Button variant="outline" size="touch" aria-pressed={focusMode} onClick={toggleFocus}><Focus />{focusMode ? "Exit focus mode" : "Enter focus mode"}</Button>
            <Button variant="outline" size="touch" disabled={!fullscreenSupported} title="Toggle fullscreen (F)"
              onClick={() => void toggleFullscreen()}>
              {isFullscreen ? <Minimize /> : <Maximize />}{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</Button>
            <Button variant="ghost" size="touch" onClick={onOpenShortcuts}><Keyboard />Keyboard shortcuts</Button>
          </div>
          <p className={styles.settingsNote}>Focus mode hides the toolbar so only the page stays in view. Fullscreen fills your screen with the reader. You can use both together.</p>
        </div>
      </div>
    </ReaderDialog>
  );
}
