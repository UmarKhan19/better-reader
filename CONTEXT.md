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
