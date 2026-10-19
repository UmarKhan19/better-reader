# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People reading their uploaded PDFs in a browser, on desktop and mobile. Specific audience segments have not been defined.

## Product purpose

Better Reader provides a personal PDF library and a reader that keeps a reader's place, bookmarks, and reading preferences.

## Operating context

The Next.js app stores uploaded documents on the server's disk and serves them through Host-guarded HTTP endpoints without authentication. Reading happens in the browser with PDF.js. Original files must remain unchanged.

## Capabilities and constraints

- Continuous scrolling is the default reading layout, as chosen by the user. Page-by-page and desktop two-page spread remain optional, with per-book preferences.
- Preserve existing progress and bookmarks, including legacy local-storage progress formats.
- Preserve the poster-led library described in DESIGN.md and the quiet, document-first reader controls.
- Provide optional blank-margin cropping, gesture zoom, search with highlighted results, location history, and chapter-aware page seeking.
- Keep rendering and thumbnail memory bounded. Background work must not delay the visible page.
- Performance claims require measurements. Local throttled-browser tests are not physical-device benchmarks.

## Product principles

- Put readable document content before controls.
- Preserve source PDFs and readers' saved state.
- Make expensive work follow the reader's intent.
- Keep reading usable when optional browser APIs or storage are unavailable.
