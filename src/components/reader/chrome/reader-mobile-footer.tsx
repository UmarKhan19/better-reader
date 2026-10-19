"use client";

import { Bookmark, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageControls, type PageControlsProps } from "./reader-page-controls";
import styles from "./reader-chrome.module.css";

export type ReaderMobileFooterProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  ready: boolean;
  pageControls: PageControlsProps;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  chromeVisible: boolean;
};

export function ReaderMobileFooter(props: ReaderMobileFooterProps) {
  const { sidebarOpen, onToggleSidebar, ready, pageControls, bookmarked, onToggleBookmark, chromeVisible } = props;
  return (
    <nav className={styles.mobileFooter} aria-label="Page navigation" data-reader-chrome inert={!chromeVisible}>
      <Button variant="ghost" size="icon-touch" aria-label="Toggle document navigation" aria-expanded={sidebarOpen}
        disabled={!ready} onClick={onToggleSidebar}><PanelLeft /></Button>
      <PageControls {...pageControls} />
      <Button variant="ghost" size="icon-touch" aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
        aria-pressed={bookmarked} disabled={!ready} onClick={onToggleBookmark}>
        <Bookmark fill={bookmarked ? "currentColor" : "none"} /></Button>
    </nav>
  );
}
