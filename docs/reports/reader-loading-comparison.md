# Historical reader loading comparison

This report preserves the measurements from the reader loading/rendering work. It is not a measurement of the later module-ownership refactor. Current loading policy, limits, benchmark commands and interpretation caveats live in [reader-performance.md](../reader-performance.md).

## Production comparison

The comparison used a fresh copy of the original source and the integrated app, both built with default Next 16.4.2 Turbopack. The original source's library was copied locally for the baseline; originals were untouched. This avoided comparing the earlier delegated Webpack baseline against Turbopack. Raw reports and logs were retained outside the source tree under `~/.cache/bk-reader-work.mnkP7x/final-evidence/`.

Desktop settings were 1440×900, DPR 1, CPU 1, no network throttle, three fresh profiles per book, eight extra jumps and a 1000 ms settle. The table reports median milliseconds from the conservative readiness proxy:

| Document | Before / after open | Before / after cached turn | Before / after uncached jump |
| --- | ---: | ---: | ---: |
| 419 pages | 546 / 607 | 53 / 26 | 104 / 113 |
| 24 pages | 604 / 699 | 74 / 34 | 49 / 107 |

The mobile smoke used 390×844, CPU 4, 100 ms latency and 750,000/250,000 B/s, with one repeat and four extra jumps. Large-document opening changed from about 11.6 s to 4.1 s. Its uncached end-of-book jump changed from 135 ms to about 2.1 s because bytes arrived on demand. The small document remained around 3.3 s before and 3.9 s after; additional reader work still cost CPU even with streaming enabled.

The interaction check observed 14 panoramic pages visible together and a rapid-zoom backing-pixel peak below 12 MP. Those observations do not replace allocation limits or prove the absence of memory leaks.

## Limits of these results

These results supported faster cached desktop turns and lower initial large-document loading delay under this throttle. They did not support an across-the-board speedup: unthrottled cold opens and some uncached jumps regressed. A 390px throttled Chromium window is an emulation, not a measured phone. Increase repeats and test representative hardware before setting release performance budgets.
