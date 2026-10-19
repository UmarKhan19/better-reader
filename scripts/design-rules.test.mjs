import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../", import.meta.url)) });
const header = "src/components/reader/chrome/reader-header.tsx";
const buttonImport = 'import { Button } from "@/components/ui/button";';
const ruleNames = ["no-restyle", "require-static-classes", "no-unknown-classes", "no-raw-colors", "no-arbitrary-values", "no-inline-styles"];

async function violations(code, filePath = header) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.ok(!result.messages.some(message => message.fatal), JSON.stringify(result.messages));
  return result.messages.filter(message => message.ruleId?.startsWith("shadcn/"));
}

test("all six design rules stay errors in screens, shared controls and rendering owners", async () => {
  for (const file of [header, "src/components/ui/button.tsx", "src/components/library/library-hero.tsx", "src/components/reader/viewport/reader-page-surface.tsx"]) {
    const config = await eslint.calculateConfigForFile(file);
    for (const rule of ruleNames) assert.equal(config.rules[`shadcn/${rule}`][0], 2, `${file}: ${rule}`);
  }
});

test("Button owns appearance and size while callers can place it and request full width", async () => {
  for (const className of ["p-10", "h-12", "min-h-12", "size-12", "w-48", "rounded-none", "text-lg", "bg-pink-500"]) {
    const messages = await violations(`${buttonImport} export const Probe = () => <Button className="${className}" />;`);
    assert.ok(messages.some(message => message.ruleId === "shadcn/no-restyle"), className);
  }
  assert.deepEqual(await violations(`${buttonImport} export const Probe = () => <Button variant="ghost" size="touch" shape="pill" className="mt-4 -mb-2 w-full lg:ms-1" />;`), []);
  assert.deepEqual(await violations(`${buttonImport} export const Probe = ({ active }: { active: boolean }) => <Button className={active ? "mt-4" : "mb-4"} />;`), []);
});

test("opaque CSS-module classes cannot bypass the shared Button contract", async () => {
  const messages = await violations(`${buttonImport} import styles from "./reader-chrome.module.css"; export const Probe = () => <Button className={styles.settingsButton} />;`);
  assert.ok(messages.some(message => message.ruleId === "shadcn/require-static-classes"));
  assert.deepEqual(await violations('import styles from "./reader-chrome.module.css"; export const Probe = () => <div className={styles.header} />;'), []);
});

test("raw colors, arbitrary values and unknown classes fail even on native elements", async () => {
  for (const [className, rule] of [["bg-pink-500", "no-raw-colors"], ["p-[13px]", "no-arbitrary-values"], ["rounded-huge", "no-unknown-classes"]]) {
    const messages = await violations(`export const Probe = () => <div className="${className}" />;`);
    assert.ok(messages.some(message => message.ruleId === `shadcn/${rule}`), className);
  }
  assert.deepEqual(await violations('export const Probe = () => <div className="bg-library-background text-library-muted font-display aspect-poster group-hover:scale-poster-hover" />;'), []);
});

test("static inline presentation is rejected and numeric custom properties remain usable", async () => {
  const messages = await violations('export const Probe = () => <div style={{ padding: 40, backgroundColor: "#ff00aa" }} />;');
  assert.equal(messages.filter(message => message.ruleId === "shadcn/no-inline-styles").length, 2);
  assert.deepEqual(await violations('export const Probe = () => <div style={{ "--progress": 20 }} />;'), []);
});

test("runtime exceptions allow only the properties in each exact owning file", async () => {
  for (const [file, properties] of [
    ["src/components/library/library-card.tsx", "width: '20%'"],
    ["src/components/library/library-grid.tsx", "transform: 'scaleX(0.2)'"],
    ["src/components/library/library-hero.tsx", "width: '20%'"],
    ["src/components/reader/pdf-reader.tsx", "transform: 'scaleX(0.2)'"],
    ["src/components/reader/chrome/reader-scrubber.tsx", "transform: 'scaleX(0.2)', insetInlineStart: '20%'"],
    ["src/components/reader/chrome/reader-sidebar.tsx", "paddingInlineStart: 28"],
    ["src/components/reader/chrome/reader-thumbnail-list.tsx", "height: 1000, top: 172"],
    ["src/components/reader/viewport/reader-page-surface.tsx", "left: 0, top: 0, width: 600, height: 800, maxWidth: 600, maxHeight: 800, zIndex: 1, pointerEvents: 'none', visibility: 'hidden', transform: 'scale(1)'"],
    ["src/components/reader/viewport/reader-tile.tsx", "left: 0, top: 0, width: 200, height: 200, visibility: 'visible'"],
    ["src/components/reader/viewport/reader-viewport.tsx", "width: 600, height: 800"],
  ]) {
    assert.deepEqual(await violations(`export const Probe = () => <div style={{ ${properties} }} />;`, file), [], file);
    const control = await violations(`${buttonImport} export const Probe = () => <Button style={{ ${properties} }} />;`, file);
    assert.ok(control.some(message => message.ruleId === "shadcn/no-inline-styles"), `${file}: shared controls cannot use geometry exceptions`);
    const blocked = await violations('export const Probe = () => <div style={{ backgroundColor: "red", padding: 20 }} />;', file);
    assert.equal(blocked.filter(message => message.ruleId === "shadcn/no-inline-styles").length, 2, file);
  }
  const messages = await violations('export const Probe = () => <div style={{ width: 200 }} />;', "src/components/reader/viewport/unrelated.tsx");
  assert.ok(messages.some(message => message.ruleId === "shadcn/no-inline-styles"));
});
