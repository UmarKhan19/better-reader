// Production interaction checks. All fixtures and settings stay in a disposable browser.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchBrowser, readConfig, readyExpression, waitFor} from './benchmark-reader.mjs';
import limits from '../src/components/reader/viewport/reader-limits.json' with { type: 'json' };

const config = readConfig({...process.env, READER_URL: process.env.READER_URL ?? 'http://localhost:3100'});
const items = (await (await fetch(`${config.origin}/api/pdfs`)).json()).items;
const id = process.env.READER_PDF_ID ?? items?.[0]?.id;
assert.match(id ?? '', /^[a-f\d-]{36}$/i, 'An existing PDF is required');
const url = `${config.origin}/read/${id}`;
const api = `${config.origin}/api/pdfs/${id}`;
const {cdp, cleanup} = await launchBrowser(config);
const timeout = 15000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = expression => cdp.evaluate(expression);
const wait = expression => waitFor(cdp, expression, timeout);
const ready = page => wait(readyExpression(page));
const settingKey = `better-reader:settings:${id}`;
const progressKey = `better-reader:progress:${id}`;

async function viewport(width, height, dpr = 1) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: dpr, mobile: width < 600});
}
async function open(preferences) {
  if (preferences) await evaluate(`localStorage.setItem(${JSON.stringify(settingKey)}, JSON.stringify(${JSON.stringify(preferences)})); localStorage.removeItem(${JSON.stringify(progressKey)})`);
  await cdp.send('Page.navigate', {url});
  await ready();
}
async function jump(page) {
  await evaluate(`(() => { const input=[...document.querySelectorAll('input[aria-label="Page number"]')].find(e=>e.getBoundingClientRect().width>0); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${page}'); input.form.requestSubmit(); })()`);
  await ready(page);
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function preferences() { return evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)}))`); }
async function point() {
  return evaluate(`(() => { const main=document.querySelector('main').getBoundingClientRect(); const holder=document.querySelector('[data-cached-page="'+document.querySelector('[data-reader-stage]').dataset.pageNumber+'"]'); const r=holder.getBoundingClientRect(); const x=Math.max(r.left+20,Math.min(r.right-20,main.left+main.width/2)),y=Math.max(main.top+100,r.top+40); return {x,y,page:Number(holder.dataset.cachedPage),fraction:{x:(x-r.left)/r.width,y:(y-r.top)/r.height}}; })()`);
}
async function assertAnchor(anchor) {
  const actual = await evaluate(`(() => { const r=document.querySelector('[data-cached-page="${anchor.page}"]').getBoundingClientRect(); return {x:r.left+${anchor.fraction.x}*r.width,y:r.top+${anchor.fraction.y}*r.height}; })()`);
  const bounds=await evaluate(`(() => {const m=document.querySelector('main'),s=document.querySelector('[data-reader-stage]'),r=s.getBoundingClientRect();return {clientLeft:m.clientLeft,clientWidth:m.clientWidth,scrollWidth:m.scrollWidth,scrollLeft:m.scrollLeft,stageLeft:r.left,stageWidth:r.width};})()`);
  assert.ok(Math.abs(actual.x-anchor.x)<4 && Math.abs(actual.y-anchor.y)<4, JSON.stringify({anchor,actual,bounds}));
}
async function budget() {
  const result = await evaluate(`(() => {const stage=document.querySelector('[data-reader-stage]'),c=[...stage.querySelectorAll('canvas')],tiles=c.filter(e=>e.hasAttribute('data-reader-tile'));return {base:c.filter(e=>!e.hasAttribute('data-reader-tile')).reduce((s,e)=>s+e.width*e.height,0),tiles:tiles.reduce((s,e)=>s+e.width*e.height,0),tileCount:tiles.length,max:Math.max(0,...c.map(e=>e.width*e.height)),holders:stage.querySelectorAll('[data-cached-page]').length,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth};})()`);
  assert.ok(result.base<=limits.basePixelBudget && result.tiles<=limits.tilePixelBudget && result.tileCount<=limits.maxTiles && result.max<=limits.pagePixelLimit, JSON.stringify(result));
  assert.equal(result.documentWidth,result.viewport);
  return result;
}
async function capture(name) {
  if (!process.env.READER_SCREENSHOTS) return;
  await mkdir(process.env.READER_SCREENSHOTS,{recursive:true});
  const {data}=await cdp.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(process.env.READER_SCREENSHOTS,`${name}.png`),Buffer.from(data,'base64'));
}
// ASCII PDF fixtures avoid installing a PDF authoring dependency or changing the library.
function fixture({pages=40,width=600,height=20,link=false,fill=false}={}) {
  const objects=['','<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const refs=[];
  for(let page=1;page<=pages;page++) {
    const object=objects.length;refs.push(object);
    const content=`${fill?'0.2 0.4 0.6 rg 0 0 '+width+' '+height+' re f\n':''}0 g BT /F1 6 Tf 8 ${Math.max(4,height-10)} Td (Fixture page ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${object+1} 0 R ${link&&page===1?`/Annots [${object+2} 0 R]`:''} >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    if(link&&page===1) objects.push('LINK');
  }
  objects[2]=`<< /Type /Pages /Count ${pages} /Kids [${refs.map(ref=>`${ref} 0 R`).join(' ')}] >>`;
  if(link) objects[6]=`<< /Type /Annot /Subtype /Link /Rect [6 ${height-18} 130 ${height-3}] /Border [0 0 0] /Contents (Jump to page 3) /Dest [${refs[2]} 0 R /Fit] >>`;
  let pdf='%PDF-1.4\n', offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
let mockedBody;
cdp.on('Fetch.requestPaused',event=>{
  void cdp.send(mockedBody===undefined?'Fetch.continueRequest':'Fetch.fulfillRequest', mockedBody===undefined?{requestId:event.requestId}:{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/pdf'},{name:'Cache-Control',value:'no-store'},{name:'Content-Length',value:String(Buffer.byteLength(mockedBody))}],body:Buffer.from(mockedBody).toString('base64')}).catch(error=>console.error('Fixture interception:',error.message));
});

try {
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  await viewport(390,844);
  await open();
  const total=await evaluate(`Number(document.querySelector('input[aria-label="Page number"]').nextElementSibling.textContent.replace(/[^0-9]/g,''))`);
  await jump(total);
  assert.equal(await evaluate(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')`),'100');
  console.log('PASS mobile last-page jump stays on its requested page');

  await viewport(1440,900);
  await open({layout:'continuous',viewMode:'fit-width',zoom:1,cropMargins:false});
  await jump(Math.min(15,total));
  const beforeCrop=await evaluate(`document.querySelector('[data-cached-page="'+document.querySelector('[data-reader-stage]').dataset.pageNumber+'"] canvas').getBoundingClientRect().width`);
  await click('button[aria-label="Reading settings"]');await click('dialog[open] input[role="switch"]');await click('button[aria-label="Close reading settings"]');
  await ready(Math.min(15,total));
  await wait(`document.querySelector('[data-cached-page="${Math.min(15,total)}"] canvas').getBoundingClientRect().width > ${beforeCrop+5}`);
  assert.equal((await preferences()).cropMargins,true);
  await budget();await capture('desktop-crop');
  console.log('PASS Fit content expands readable ink without changing source bytes');

  await open({layout:'continuous',viewMode:'fit-width',zoom:1,cropMargins:false});
  await jump(Math.min(15,total));
  const anchor=await point();
  for(let i=0;i<2;i++) await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:anchor.x,y:anchor.y,deltaX:0,deltaY:-100,modifiers:2});
  await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)})).viewMode === 'custom'`);await ready();
  await assertAnchor(anchor);await budget();
  console.log('PASS Ctrl-wheel zoom preserves its pointer anchor');

  await viewport(390,844);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  await open({layout:'continuous',viewMode:'fit-width',zoom:1,cropMargins:false});
  await jump(Math.min(15,total));
  const pinch=await point(), startScale=await evaluate(`document.querySelector('[data-cached-page="${pinch.page}"]').getBoundingClientRect().width`);
  const touches=distance=>[{x:pinch.x+35-distance/2,y:pinch.y+90,id:1},{x:pinch.x+35+distance/2,y:pinch.y+90,id:2}];
  const pinchAnchor={...pinch,x:pinch.x+35,y:pinch.y+90};
  pinchAnchor.fraction=await evaluate(`(() => {const r=document.querySelector('[data-cached-page="${pinch.page}"]').getBoundingClientRect();return {x:(${pinchAnchor.x}-r.left)/r.width,y:(${pinchAnchor.y}-r.top)/r.height};})()`);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(50)});
  for(const distance of [55,60,65,70,75]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(distance)});await pause(20);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)})).viewMode === 'custom'`);await ready();
  const pinchedWidth=await evaluate(`document.querySelector('[data-cached-page="${pinch.page}"]').getBoundingClientRect().width`);
  assert.ok(Math.abs(pinchedWidth/startScale-1.5)<0.04,JSON.stringify({startScale,pinchedWidth}));
  await assertAnchor(pinchAnchor);await budget();
  console.log('PASS trusted two-finger pinch zoom and touch anchor');

  await open({layout:'continuous',viewMode:'fit-width',zoom:1,cropMargins:false});await jump(Math.min(15,total));
  const tap=await point();
  for(let i=0;i<2;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tap.x,y:tap.y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(70);}
  await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(settingKey)})).viewMode === 'custom'`);await ready();await budget();
  console.log('PASS trusted double-tap zoom');

  await viewport(1440,900,2);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await open({layout:'single',viewMode:'custom',zoom:4,cropMargins:false});
  await wait(`!![...document.querySelectorAll('[data-reader-tile]')].find(c=>c.width>0&&getComputedStyle(c).visibility==='visible')`);
  await budget();await capture('desktop-high-zoom');
  await evaluate(`window._pixelPeak=0;window._watchPixels=setInterval(()=>{const c=[...document.querySelectorAll('[data-reader-stage] canvas')];window._pixelPeak=Math.max(window._pixelPeak,c.reduce((s,e)=>s+e.width*e.height,0));},5);document.querySelector('main').focus()`);
  for(let i=0;i<8;i++){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'-',code:'Minus'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'-',code:'Minus'});}
  await ready();await pause(200);await budget();
  const peak=await evaluate('clearInterval(window._watchPixels);window._pixelPeak');assert.ok(peak<=18_070_000,`Rapid zoom peak ${peak}`);
  console.log('PASS high-resolution tiles and rapid-zoom pixel bounds',JSON.stringify({peak,...await budget()}));

  await viewport(1440,900);await open({layout:'continuous',viewMode:'fit-width',zoom:1,cropMargins:false});
  await evaluate(`window._seekRequests=0;window._seekObserver=new PerformanceObserver(list=>{window._seekRequests+=list.getEntries().filter(e=>e.name==='reader:page-request').length});window._seekObserver.observe({entryTypes:['mark']})`);
  const track=await evaluate(`(() => {const r=document.querySelector('input[aria-label="Seek to page"]').getBoundingClientRect();return {left:r.left,width:r.width,y:r.top+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:track.left+track.width*.15,y:track.y,button:'left',clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:track.left+track.width*.65,y:track.y,button:'left',buttons:1});await pause(250);
  assert.equal(await evaluate('window._seekRequests'),0,'Dragging must not navigate');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:track.left+track.width*.65,y:track.y,button:'left',clickCount:1});await ready();await pause(80);
  assert.equal(await evaluate('window._seekRequests'),1,'Accepted seek commits exactly once');
  console.log('PASS pointer scrubber previews without navigation and commits once');

  await cdp.send('Fetch.enable',{patterns:[{urlPattern:api,requestStage:'Request'}]});
  mockedBody=fixture();await open({layout:'continuous',viewMode:'fit-width',zoom:1,cropMargins:false});await jump(1);
  await wait(`document.querySelectorAll('[data-cached-page]:not([aria-hidden])').length > 6`);await ready(1);
  let visible=await evaluate(`(() => {const m=document.querySelector('main').getBoundingClientRect();return [...document.querySelectorAll('[data-cached-page]:not([aria-hidden])')].filter(e=>{const r=e.getBoundingClientRect();return r.bottom>m.top&&r.top<m.bottom}).map(e=>({page:e.dataset.cachedPage,ready:!!e.querySelector('canvas')}));})()`);
  assert.ok(visible.length>6 && visible.every(page=>page.ready),JSON.stringify(visible));await budget();
  await jump(40);assert.equal(await evaluate(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')`),'100');await budget();await capture('panoramic-window');
  console.log('PASS more-than-six visible panoramic pages and last-page navigation',JSON.stringify({visible:visible.length,...await budget()}));

  mockedBody=fixture({pages:3,width:600,height:800,link:true});await open({layout:'single',viewMode:'fit-page',zoom:1,cropMargins:false});await jump(1);
  await wait(`!!document.querySelector('[data-cached-page="1"] .annotationLayer a')`);await click('[data-cached-page="1"] .annotationLayer a');await ready(3);await click('button[aria-label="Back to previous location"]');await ready(1);
  console.log('PASS actual internal PDF link and previous-location recovery');

  mockedBody='not a PDF';await cdp.send('Page.navigate',{url});await wait(`!!document.querySelector('[role="alert"] button')`);
  mockedBody=fixture({pages:3,width:600,height:800,fill:true});await click('[role="alert"] button');await ready();await budget();
  console.log('PASS failed-document retry with original library untouched');
} catch (error) {
  console.error('Interaction state', JSON.stringify(await evaluate(`({page:document.querySelector('[data-reader-stage]')?.dataset.pageNumber,busy:document.querySelector('[data-reader-stage]')?.getAttribute('aria-busy'),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),holders:[...document.querySelectorAll('[data-cached-page]')].map(e=>({page:e.dataset.cachedPage,hidden:e.getAttribute('aria-hidden'),top:e.getBoundingClientRect().top,canvases:[...e.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,visible:getComputedStyle(c).visibility}))})),links:[...document.querySelectorAll('.annotationLayer a')].map(a=>({href:a.getAttribute('href'),onclick:!!a.onclick})),request:performance.getEntriesByName('reader:page-request').map(e=>e.detail)})`)));
  throw error;
} finally { await cleanup(); }
