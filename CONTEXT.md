# Domain terms

- **Book**: one library entry representing an uploaded PDF.
- **Original PDF**: the uploaded document. Paper modes, cropping and other reading preferences do not change it.
- **Page**: a page in the original PDF, numbered from 1. Blank pages and pages without searchable text retain their numbers.
- **Reading location**: a page and a fractional vertical offset within it.
- **Reading progress**: a saved reading location, optionally with a known page count. Missing progress means unread, not a saved visit to page 1.
- **Bookmark**: a saved page the reader can return to.
- **Outline**: a document's table of contents, with nested entries and destinations that may be unavailable.
- **Passage**: a piece of extracted book text that retains its original page and can be returned as evidence.
- **Trash**: a deleted book that remains eligible for restore until its retention window expires.

## Code names

- Book: `PdfItem` on the browser/wire; `StoredPdfRecord` on disk.
- Original PDF: `uploads/<id>.pdf`.
- Page count: reader code and props say `pageCount`; saved progress keeps `numPages`.
- Reader view mode: `viewMode` means page sizing (`fit-width`, `fit-page`, `actual-size`, `custom`); `layout` separately means `continuous`, `single` or `spread`. The saved settings key remains `viewMode`.
- Reading location: `ReadingLocation`; reading progress: `SavedReadingProgress`.
- Bookmark: `number[]` in `better-reader:bookmarks:<id>`.
- Outline: `OutlineEntry`.
- Passage: `IndexedChunk` in `book-index`.
- Trash: `TrashRecord` and `data/trash.json`.

The checkout directory is `better-kindle`, the package name is `better-reader`, and the product is "Better Reader". These names are intentional; do not rename them.
