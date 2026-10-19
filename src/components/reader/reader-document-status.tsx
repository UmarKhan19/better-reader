"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import styles from "./reader.module.css";
import chromeStyles from "./chrome/reader-chrome.module.css";

export function ReaderDocumentLoading() {
  return <main className={styles.documentStatusMain}>
    <div className={styles.documentStatus} role="status">
      <div className={styles.loadingPage} aria-hidden="true"><span /><span /><span /><span /><span /></div>
      <p>Opening your PDF…</p>
    </div>
  </main>;
}

export function ReaderDocumentError({ loadError, onRetry }: { loadError: boolean; onRetry: () => void }) {
  return <main className={styles.documentStatusMain}>
    <div className={styles.documentStatus} role="alert"><p>{loadError ? "This PDF couldn't be opened." : "Unable to open this PDF."}</p>
      <p>Try again, or return to your library.</p>
      <Button variant="outline" size="touch" onClick={onRetry}>Try again</Button>
      <Link href="/" className={chromeStyles.textLink}>Back to library</Link></div>
  </main>;
}
