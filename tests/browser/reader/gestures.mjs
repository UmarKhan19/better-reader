import assert from "node:assert/strict";

export async function checkGestures(reader) {
  const { cdp, settingKey, evaluate, wait, ready, viewport, open, jump, totalPages, point, assertAnchor, budget, pause } = reader;
  const total = await totalPages();
  await viewport(1440, 900);
  await open({ layout: "continuous", viewMode: "fit-width", zoom: 1, cropMargins: false });
  await jump(Math.min(15, total));
  const anchor = await point();
  for (let i = 0; i < 2; i++) await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: anchor.x, y: anchor.y, deltaX: 0, deltaY: -100, modifiers: 2 });
  await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)})).viewMode === 'custom'`);
  await ready();
  await assertAnchor(anchor);
  await budget();
  console.log("PASS Ctrl-wheel zoom preserves its pointer anchor");

  await viewport(390, 844);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await open({ layout: "continuous", viewMode: "fit-width", zoom: 1, cropMargins: false });
  await jump(Math.min(15, total));
  const pinch = await point(), startScale = await evaluate(`document.querySelector('[data-cached-page="${pinch.page}"]').getBoundingClientRect().width`);
  const touches = distance => [{ x: pinch.x+35-distance/2, y: pinch.y+90, id: 1 }, { x: pinch.x+35+distance/2, y: pinch.y+90, id: 2 }];
  const pinchAnchor = { ...pinch, x: pinch.x+35, y: pinch.y+90 };
  pinchAnchor.fraction = await evaluate(`(() => {const r=document.querySelector('[data-cached-page="${pinch.page}"]').getBoundingClientRect();return {x:(${pinchAnchor.x}-r.left)/r.width,y:(${pinchAnchor.y}-r.top)/r.height};})()`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(50) });
  for (const distance of [55, 60, 65, 70, 75]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(distance) });
    await pause(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)})).viewMode === 'custom'`);
  await ready();
  const pinchedWidth = await evaluate(`document.querySelector('[data-cached-page="${pinch.page}"]').getBoundingClientRect().width`);
  assert.ok(Math.abs(pinchedWidth/startScale-1.5) < 0.04, JSON.stringify({ startScale, pinchedWidth }));
  await assertAnchor(pinchAnchor);
  await budget();
  console.log("PASS trusted two-finger pinch zoom and touch anchor");

  await open({ layout: "continuous", viewMode: "fit-width", zoom: 1, cropMargins: false });
  await jump(Math.min(15, total));
  const tap = await point();
  for (let i = 0; i < 2; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tap.x, y: tap.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pause(70);
  }
  await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)})).viewMode === 'custom'`);
  await ready();
  await budget();
  console.log("PASS trusted double-tap zoom");
}
