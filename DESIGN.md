# Design — Better Reader Library

## Visual world

Netflix, with a day/night split. Dark is the screening room: full-bleed poster hero, black ground, red marquee type. Light is the sunlit poster wall: paper ground, ink type, the same posters in full color. No sidebar, no boxes.

## Palette

- Ground: #141414 (dark), neutral-50 (light)
- Text: white / neutral-300 (dark), neutral-900 / neutral-600 (light)
- Accent: #e50914 (red) for the logo, the progress fill, the primary upload action, and text selection
- The small logo uses #ff3440 on dark mobile headers to keep its text contrast above 4.5:1.
- Surfaces: neutral-800/900 (dark), white/neutral-100 (light)
- Scrollbars: neutral thumb, drawn from the palette, never the OS default

## Typography

- Display: Bebas Neue (condensed) for the logo, hero title, section headings, status chips, and the empty state.
- Body: Geist.
- Titles on cards: text-xs font-semibold.
- Filenames are the only title available: the extension is stripped and separators become spaces before display (actions and aria labels use the same string).
- PDFs without covers get flat, muted-color jackets with readable condensed titles and large two-letter monograms. Artwork type scales with the poster, not the viewport.

## Composition

- Top nav: logo, pill search field from 1024px upward, full-bar search overlay below that, segmented theme control, upload button (icon-only on mobile). Search has a clear action and a red focus ring.
- Hero: full-width poster backdrop with a theme-aware scrim, title and metadata at left, a tilted book jacket at right. The jacket stacks above the text on mobile. Desktop minimum height is 528px, rising to 576px on wider screens. Reading progress has its own page count and percentage above a thin red bar. Resume/Start reading remains primary, with an anchor to the library beside it.
- Rows: horizontal scroll with snap and edge fades only where more content exists. Circular arrows sit beside the heading, appear only for overflowing rows, and disable at each end.
- Grid: 2-6 columns, poster cards 2:3, hover lift with ring and shadow.
- First grid cell is the dashed upload tile; drag state turns it red and the whole stage answers with a drop overlay.
- Search replaces the hero and continue-reading row with counted results at the top. Results match both original filenames and their displayed titles; the upload tile stays out of the results.
- Footer: a single muted strip with title count, total size, and "Stored locally."

## Controls

- Primary: white fill with black text on dark, ink fill with white text on light; red upload button.
- Card controls: top-left add/remove cover, top-right delete; visible on touch, revealed on hover or keyboard focus elsewhere.
- Add cover inverts to white on hover; remove and delete go red.
- Focus rings are red on every custom control.

## Motion

- One authored entrance: hero content rises in stages on load; removed under prefers-reduced-motion.
- Card hover: 6% image zoom, 4px lift, ring and shadow, 300ms ease-out. No bounce.
- Rows scroll smoothly; nothing animates on scroll. Reduced motion also removes card lift, cover zoom, and smooth row scrolling.

## Design system ownership

- `src/app/globals.css` owns shared tokens. `library-*` colors carry the library's light/dark pairs, so screens use roles such as `bg-library-background` and `text-library-muted` without rebuilding the palette at each call site. `brand` is the action red; `brand-readable` is the brighter red for small text on dark backgrounds.
- Feedback uses `success`, `warning` and `error` foreground, surface and border tokens. Shared dialogs use the existing popover, border and muted-foreground tokens.
- `font-display`, `leading-display`, `tracking-display`, `text-label` and `tracking-stamp` own display typography. `aspect-poster` fixes the book ratio; `scale-poster-hover` owns the cover lift's zoom. Upload progress animates a transform rather than width and respects reduced motion. Ordinary spacing stays on Tailwind's scale.
- The five named poster palettes live in `globals.css`. `library.module.css` owns the illustration's geometry, container-relative type, hero composition and entrance timing. These one-off illustration coordinates are not application-wide spacing tokens. Reader CSS modules retain ownership of their document, panel and paper treatments.
- `src/components/ui/button.tsx` owns shared button appearance. Use `variant`, `size` and `shape`, not padding, fixed dimensions, color or CSS-module overrides at call sites. `shape="pill"` is explicit; `size="reader-home"` owns the responsive library-return control; `variant="reader-settings"` owns the mobile/desktop settings treatment. Callers may use margins, display, self-alignment, ordering, grid placement and `w-full`. Put more complex layout on a parent.

## Enforced checks

`bun run lint` runs all six `@shadcn/lint` rules as errors and rejects warnings. The existing `bun run check` and CI workflow include it. `scripts/design-rules.test.mjs` checks actual allowed and rejected examples against the application config.

- `no-restyle` and `require-static-classes` protect shared controls from visual overrides and opaque class expressions. Static conditionals and `cn()` remain valid. Native elements can use owner-scoped CSS modules.
- `no-raw-colors`, `no-arbitrary-values` and `no-unknown-classes` require declared theme values, scale values and valid utilities in class-bearing application code. Define a shared token only for a shared design decision, not to give every literal a new name.
- `no-inline-styles` keeps static presentation in classes or CSS. `eslint.config.mjs` allows only specific properties on native elements in exact runtime owners: card/hero progress widths, upload/reader progress transforms, scrubber positions, outline indentation, thumbnail virtualization, page geometry, raster transforms and tile dimensions/visibility. Shared controls cannot inherit these exceptions. Static entrance delays and poster colors have no inline exception.

The plugin checks JSX and class expressions, not CSS declarations. Review CSS-module changes for token use and shared-control overrides; a clean lint run does not prove visual parity or accessibility. After UI changes, build and run the isolated browser checks in `docs/architecture.md`.
