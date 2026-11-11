/** Offline browser check of the actual Android bundle; simulated transport only. */
import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve('android/app/build/webAssets/www');
const browser=await chromium.launch();
try {
  const page=await browser.newPage(); const errors=[]; const external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='https://appassets.androidplatform.net'){external.push(url.href);return route.abort();}
    const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root+'/'))return route.abort();
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png'}[extname(path)] || 'application/octet-stream';
    try { await route.fulfill({body:await readFile(path),contentType:mime}); } catch { await route.abort(); }
  });
  await page.addInitScript(()=>{
    window.canopyAmber={onmessage:null,postMessage(raw){const r=JSON.parse(raw);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({id:r.id,result:'1'.repeat(64)})}));}};
  });
  await page.goto('https://appassets.androidplatform.net/');
  await expect(page.getByRole('heading',{name:'Find your signal.'})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  expect(errors).toEqual([]);expect(external).toEqual([]);
  expect(await page.evaluate(()=>typeof window.nostr?.getPublicKey)).toBe('function');
  expect(await page.evaluate(()=>window.nostr.getPublicKey())).toBe('1'.repeat(64));
  console.log('Android bundle starts offline, loads bundled fonts under CSP, and validates the simulated public-key transport.');
} finally {await browser.close();}
