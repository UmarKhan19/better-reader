import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";

test("shared buttons own shape without forwarding design props to the DOM", () => {
  const normal = renderToStaticMarkup(<Button disabled aria-label="Read">Read</Button>);
  assert.match(normal, /rounded-lg/);
  assert.match(normal, /disabled=""/);
  assert.match(normal, /aria-label="Read"/);
  const pill = renderToStaticMarkup(<Button variant="reader-settings" size="touch" shape="pill">Settings</Button>);
  assert.match(pill, /rounded-full/);
  assert.match(pill, /lg:bg-foreground/);
  assert.doesNotMatch(pill, /rounded-lg| shape=| variant=| size=/);
});

test("the library-return size keeps its narrow and wide screen dimensions together", () => {
  const html = renderToStaticMarkup(<Button variant="ghost" size="reader-home" shape="pill">Library</Button>);
  assert.match(html, /h-11 w-11/);
  assert.match(html, /lg:w-auto/);
  assert.match(html, /lg:rounded-none/);
  assert.match(html, /lg:border-e-border/);
});
