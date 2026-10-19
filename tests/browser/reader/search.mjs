import assert from "node:assert/strict";

export function checkSearch(reader) {
  const { browser, evaluate, wait, click, screenshot, ready, jump, totalPages, fitWidth, findTextPage } = reader;
  browser("press", "/");
  wait("document.activeElement === document.querySelector('[data-reader-search] input')");
  assert.equal(evaluate("document.activeElement.type"), "search");
  click('button[aria-label="Close document navigation"]');
  browser("press", "Control+f");
  wait("document.activeElement === document.querySelector('[data-reader-search] input')");
  click('button[aria-label="Close document navigation"]');
  console.log("PASS keyboard Search opens and focuses the real input");

  const total = totalPages(), samplePage = Math.min(16, total);
  jump(samplePage);
  const current = findTextPage(samplePage, total);
  if (!current) {
    console.log(`SKIP mobile search checks: no text layer near page ${samplePage}`);
    return;
  }
  const activeTextLayer = `[data-reader-stage] [data-cached-page="${current}"] [aria-hidden="false"] .textLayer`;
  browser("set", "viewport", "390", "844");
  ready(current);
  fitWidth();
  wait(`!![...document.querySelectorAll('${activeTextLayer} span')].find(s => /[a-zA-Z]{4,}/.test(s.textContent))`);
  const query = evaluate(`[...document.querySelectorAll('${activeTextLayer} span')].map(s => s.textContent.match(/[a-zA-Z]{4,}/)?.[0]).find(Boolean)`);
  const departure = current === 1 ? Math.min(2, total) : 1;
  jump(departure);
  click('button[aria-label="Search document"]');
  wait("!!document.querySelector('dialog[open] [data-reader-search] input') && document.activeElement === document.querySelector('dialog[open] [data-reader-search] input')");
  browser("fill", 'dialog[open] [data-reader-search] input', query);
  wait(`!!document.querySelector('[data-search-result-page="${current}"]')`);
  screenshot("mobile-search");
  click(`[data-search-result-page="${current}"]`);
  wait("!document.querySelector('dialog[open]')");
  ready(current);
  // A match can span several original PDF text items and mark nodes.
  wait(`[...document.querySelectorAll('${activeTextLayer} mark')].map(m => m.textContent).join('').toLowerCase().includes(${JSON.stringify(query.toLowerCase())})`);
  const visibleMarks = evaluate(`[...document.querySelectorAll('${activeTextLayer} mark')].map(m => m.textContent)`);
  assert.ok(visibleMarks.join("").toLowerCase().includes(query.toLowerCase()),
    `Visible page marks must survive closing the mobile drawer: ${JSON.stringify({ query, visibleMarks })}`);
  screenshot("mobile-search-result");
  click('button[aria-label="Search document"]');
  wait("document.activeElement === document.querySelector('dialog[open] [data-reader-search] input')");
  assert.equal(evaluate("document.querySelector('[data-reader-search] input').value"), query);
  assert.ok(evaluate(`!!document.querySelector('[data-search-result-page="${current}"]')`), "Same-query results stay available when reopening Search");
  browser("focus", 'dialog[open] [data-reader-search] input');
  browser("press", "Control+a");
  browser("press", "Backspace");
  wait(`!document.querySelector('${activeTextLayer} mark') && !document.querySelector('[data-search-result-page]')`);
  browser("press", "Escape");
  wait("!document.querySelector('dialog[open]')");
  click('button[aria-label="Back to previous location"]');
  ready(departure);
  console.log("PASS mobile Search focus, result-click drawer close, retained page marks/results, explicit clear and Back");
}
