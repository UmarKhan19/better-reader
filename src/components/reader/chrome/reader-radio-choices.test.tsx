import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RadioChoices } from "./reader-radio-choices";

test("paper previews keep named, mutually exclusive radio controls and the saved selection", () => {
  const html = renderToStaticMarkup(<RadioChoices legend="Paper" presentation="paper" value="sepia"
    onChange={() => {}} options={[
      { value: "original", label: "Original" }, { value: "dimmed", label: "Dimmed" },
      { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" },
    ]} />);
  assert.ok(html.includes("<legend>Paper</legend>"));
  assert.equal([...html.matchAll(/type="radio"/g)].length, 4);
  assert.equal(new Set([...html.matchAll(/name="([^"]+)"/g)].map((match) => match[1])).size, 1);
  assert.match(html, /checked="" value="sepia"/);
  for (const paper of ["original", "dimmed", "sepia", "dark"]) {
    assert.ok(html.includes(`data-paper-option="${paper}"`));
  }
  assert.equal([...html.matchAll(/>Aa<\/span>/g)].length, 4);
});
