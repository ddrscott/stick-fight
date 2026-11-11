#!/usr/bin/env node
// The join link's QR code (src/qr.js): does a separate decoder read back the link it was made from?
// The decoder is jsQR (a dev dependency; the game itself ships none).
//
//   node scripts/qr/check.mjs                      the encoder alone: every text length, and real links of both kinds
//   npm run build && npx wrangler dev --port 8787  then, with the Worker up (it makes the rooms):
//   node scripts/qr/check.mjs --url http://127.0.0.1:8787/stick-fight/ [--out dir]
//
// With --url it opens the host screen (before the room opens, and after) and a crew lobby in headless
// Chromium at 1280x720, 844x390 and 390x844, decodes the code out of each whole screenshot, and checks
// the layout: the tile is the same size before and after, sits inside the stage, covers no button or
// text, and never takes the focus. --out keeps the screenshots and a contact sheet. Exit code 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { encodeQR, QR_QUIET } from '../../src/qr.js';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const argv = process.argv.slice(2);
const opt = (k, d = '') => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('--url') ? opt('--url').replace(/\/?$/, '/') : '';
const OUT = opt('--out') ? path.resolve(opt('--out')) : '';

let failed = 0, passed = 0;
const check = (what, ok, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); };

// ---- 1. the encoder alone ---------------------------------------------------------------------------------
/** the code as pixels: black on white, `px` pixels a module, with the quiet zone */
function raster(qr, px) {
  const n = (qr.size + 2 * QR_QUIET) * px, d = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.get(Math.floor(x / px) - QR_QUIET, Math.floor(y / px) - QR_QUIET)) continue;
    const i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0;
  }
  return { d, n };
}
const readBack = (text, px = 4) => { const qr = encodeQR(text); if (!qr) return null; const { d, n } = raster(qr, px); const r = jsQR(d, n, n); return { qr, text: r ? r.data : null }; };

const LINKS = [
  ['a quick room', 'https://askscottpierce.com/stick-fight/room/K7QX'],
  ['a crew room', 'https://askscottpierce.com/stick-fight/crew/tuesday-crew-7k2qm'],
  ['the longest crew name', 'https://askscottpierce.com/stick-fight/crew/wwwwwwwwwwwwwwwwwwww-7k2qm'],
  ['a quick room on npm run dev', 'http://localhost:8077/room/K7QX'],
  ['a crew room on a dev tunnel', 'https://stick-fight-dev.dataturd.com/crew/tuesday-crew-7k2qm'],
];
for (const [name, link] of LINKS) {
  const r = readBack(link);
  check(`${name} reads back`, !!r && r.text === link, r ? `version ${r.qr.version}, ${r.qr.size} modules, ${new TextEncoder().encode(link).length} bytes` : 'no code');
}
{
  // every length the encoder takes (versions 1 to 10), at 3 and 4 pixels a module, with some non-ASCII in it
  let bad = 0, top = 0;
  const versions = new Set();
  for (let len = 1; len <= 230; len++) {
    let t = ''; while (new TextEncoder().encode(t).length < len) t += 'https://x.y/play/?crew=abc-DEF_09~%é'[(t.length * 7 + len) % 36];
    const bytes = new TextEncoder().encode(t).length;
    for (const px of [3, 4]) {
      const r = readBack(t, px);
      if (!r) continue;
      top = Math.max(top, bytes); versions.add(r.qr.version);
      if (r.text !== t) { bad++; console.log(`      length ${bytes} at ${px}px: got ${JSON.stringify(r.text)}`); }
    }
  }
  check('every length reads back', bad === 0 && versions.size === 10, `1 to ${top} bytes, versions ${[...versions].join(' ')}`);
  check('a text too long gets no code', encodeQR('x'.repeat(214)) === null && encodeQR('x'.repeat(213)) !== null);
}

// ---- 2. on the screens ------------------------------------------------------------------------------------
if (BASE) {
  const { chromium, executablePath } = await import('../../gauntlet/browser.mjs');
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const SIZES = [
    { name: '1280x720', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
    { name: '844x390', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    { name: '390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  ];
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const crew = await (await fetch(`${BASE}api/crews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'TUESDAY CREW' }) })).json();
  check('made a crew room', !!crew.slug, crew.slug);

  /** the QR code read out of a whole screenshot */
  async function decode(png) {
    const img = await loadImage(png);
    const c = createCanvas(img.width, img.height), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const r = jsQR(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height);
    return r ? r.data : null;
  }
  // where everything on the screen is, in CSS px
  function measure() {
    const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, text: (n.textContent || '').trim().slice(0, 24), cls: String(n.className).split(' ').slice(0, 2).join('.') }; };
    const st = document.getElementById('stage').getBoundingClientRect();
    const tile = document.querySelector('#flow .fl-qrtile'), label = document.querySelector('#flow .fl-qrlabel');
    const others = [...document.querySelectorAll('#flow .fl-screen :is(.fl-h1, .fl-h2, .fl-label, .fl-link, .fl-btn, .fl-standings, .fl-recent, .fl-crewstatus)')].filter((n) => n.getBoundingClientRect().width);
    const svg = tile && tile.querySelector('svg');
    return {
      stage: { x: st.left, y: st.top, w: st.width, h: st.height },
      tile: tile && box(tile), label: label && box(label), others: others.map(box),
      drawn: !!svg, modules: svg ? Number(svg.getAttribute('viewBox').split(' ')[2]) : 0,
      link: (document.querySelector('#flow .fl-link') || {}).textContent || '',
      focus: (document.querySelector('#flow .fl-focus') || {}).tagName || '',
      qrFocusable: !!document.querySelector('#flow .fl-qr.fl-btn, #flow .fl-qr .fl-btn, #flow .fl-qr[tabindex], #flow .fl-qr button'),
      state: window.__flow.state,
    };
  }
  const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  function layout(tag, m) {
    check(`${tag}: the tile and its label are inside the stage`, !!m.tile && inside(m.tile, m.stage) && inside(m.label, m.stage), m.tile ? `${Math.round(m.tile.w)}px tile in a ${Math.round(m.stage.w)}x${Math.round(m.stage.h)} stage` : 'no tile');
    if (!m.tile || !m.label) return;
    const out = m.others.filter((o) => !inside(o, m.stage)), hit = m.others.filter((o) => overlap(o, m.tile) || overlap(o, m.label));
    check(`${tag}: every button and line of text is inside the stage`, out.length === 0, out.map((o) => `${o.cls} "${o.text}"`).join(', '));
    check(`${tag}: the code covers nothing`, hit.length === 0, hit.map((o) => `${o.cls} "${o.text}"`).join(', '));
    check(`${tag}: the focus is on a button, never the code`, m.focus === 'BUTTON' && !m.qrFocusable, m.focus);
  }

  const shots = [];
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor, hasTouch: size.hasTouch, isMobile: size.isMobile });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('stick-fight-player')) localStorage.setItem('stick-fight-player', JSON.stringify({ id: 'a'.repeat(32), name: 'ALICE', email: '', crews: [] })); } catch { /* private */ } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => check(`[${size.name}] no page errors`, false, e.message));
    // hold the room's creation, so the screen can be seen before the room opens
    let release = () => {};
    const held = new Promise((r) => { release = r; });
    await page.route('**/api/rooms', async (route) => { if (route.request().method() === 'POST') await held; await route.continue(); });
    const snap = async (name) => {
      await sleep(700);
      const png = await page.screenshot();
      if (OUT) fs.writeFileSync(path.join(OUT, `${size.name}-${name}.png`), png);
      shots.push({ size: size.name, name, png });
      return png;
    };
    await page.goto(`${BASE}play/`);
    await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract' && document.fonts.status === 'loaded', null, { timeout: 30000 });
    await sleep(800);

    // the host screen, before the room opens: an empty tile
    await page.evaluate(() => { for (const s of ['modeSelect', 'onlineMenu', 'onlineHost']) window.__flow.debug.go(s); });
    await page.waitForFunction(() => window.__flow.state === 'onlineHost');
    const png0 = await snap('host-opening');
    const m0 = await page.evaluate(measure);
    check(`[${size.name}] host, room opening: an empty tile, no link yet`, !!m0.tile && !m0.drawn && !m0.link, m0.tile ? `${Math.round(m0.tile.w)}x${Math.round(m0.tile.h)}` : 'no tile');
    check(`[${size.name}] host, room opening: nothing to scan`, (await decode(png0)) === null);
    layout(`[${size.name}] host, room opening`, m0);

    // the room opens: the code is drawn in the same tile
    release();
    await page.waitForFunction(() => !!(document.querySelector('#flow .fl-link') || {}).textContent, null, { timeout: 15000 });
    const png1 = await snap('host-open');
    const m1 = await page.evaluate(measure);
    const got1 = await decode(png1);
    check(`[${size.name}] host: the screenshot's code reads back as the quick-room link`, !!m1.link && got1 === m1.link && /\/room\/[A-Z0-9]{4}$/.test(m1.link), `${got1}  ·  ${m1.modules} modules across, ${(m1.tile.w * size.deviceScaleFactor / m1.modules).toFixed(1)} device px each`);
    const same = (a, b) => Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6 && Math.abs(a.w - b.w) < 0.6 && Math.abs(a.h - b.h) < 0.6;
    check(`[${size.name}] host: the tile didn't move or change size when the room opened`, same(m0.tile, m1.tile), `${Math.round(m0.tile.x)},${Math.round(m0.tile.y)} ${Math.round(m0.tile.w)} -> ${Math.round(m1.tile.x)},${Math.round(m1.tile.y)} ${Math.round(m1.tile.w)}`);
    const moved = m1.others.filter((o) => o.cls.includes('fl-btn')).filter((o, i) => { const b = m0.others.filter((p) => p.cls.includes('fl-btn'))[i]; return !b || Math.abs(b.x - o.x) > 0.6 || Math.abs(b.y - o.y) > 0.6; });
    check(`[${size.name}] host: no button moved when the room opened`, moved.length === 0, moved.map((o) => o.text).join(', '));
    layout(`[${size.name}] host`, m1);
    // the keys and the pad walk the buttons only
    const seen = new Set();
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) { await page.keyboard.press(k); seen.add(await page.evaluate(() => { const f = document.querySelector('#flow .fl-focus'); return f ? `${f.tagName}:${f.textContent}` : 'none'; })); }
    check(`[${size.name}] host: the arrow keys only ever land on buttons`, [...seen].every((s) => s.startsWith('BUTTON:')) && seen.size >= 3, `${seen.size} buttons`);

    // the crew lobby
    await page.goto(`${BASE}crew/${crew.slug}`);
    await page.waitForFunction(() => window.__flow && window.__flow.state === 'crewLobby' && document.fonts.status === 'loaded' && /ALICE/.test((document.querySelector('#flow .fl-standings') || {}).textContent || ''), null, { timeout: 30000 });
    const png2 = await snap('crew-lobby');
    const m2 = await page.evaluate(measure);
    const got2 = await decode(png2);
    check(`[${size.name}] crew: the screenshot's code reads back as the crew link`, !!m2.link && got2 === m2.link && m2.link.endsWith(`/crew/${crew.slug}`), `${got2}  ·  ${m2.modules} modules across, ${(m2.tile.w * size.deviceScaleFactor / m2.modules).toFixed(1)} device px each`);
    layout(`[${size.name}] crew`, m2);
    await ctx.close();
  }
  await browser.close();

  if (OUT) {   // the contact sheet: a row a size, the three screens across
    const H = 360, GAP = 16, TOP = 34;
    const imgs = await Promise.all(shots.map(async (s) => ({ ...s, img: await loadImage(s.png) })));
    const rows = SIZES.map((s) => imgs.filter((i) => i.size === s.name));
    // an upright phone's stage is the top of the page (the rest is empty): show that part
    const srcH = (i) => (i.img.height > i.img.width ? Math.round(i.img.width * 0.75) : i.img.height);
    const wOf = (i) => Math.round(i.img.width * H / srcH(i));
    const W = Math.max(...rows.map((r) => r.reduce((a, i) => a + wOf(i) + GAP, GAP)));
    const c = createCanvas(W, rows.length * (H + TOP + GAP) + GAP), g = c.getContext('2d');
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, c.width, c.height);
    g.font = '18px monospace'; g.textBaseline = 'middle';
    rows.forEach((r, k) => {
      let x = GAP; const y = GAP + k * (H + TOP + GAP);
      for (const i of r) { g.fillStyle = '#E85D00'; g.fillText('//', x, y + TOP / 2); g.fillStyle = '#eee'; g.fillText(` ${i.size.toUpperCase()}_${i.name.toUpperCase().replace(/-/g, '_')}`, x + 20, y + TOP / 2); g.drawImage(i.img, 0, 0, i.img.width, srcH(i), x, y + TOP, wOf(i), H); x += wOf(i) + GAP; }
    });
    fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), c.toBuffer('image/png'));
    console.log(`screenshots and contact-sheet.png in ${OUT}`);
  }
}

console.log(failed ? `${failed} FAILED, ${passed} passed` : `all ${passed} checks passed`);
process.exit(failed ? 1 : 0);
