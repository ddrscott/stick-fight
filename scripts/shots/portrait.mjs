#!/usr/bin/env node
// Fight screenshots on a phone held upright (README, Controls, "Held upright: the view"), with the
// sideways phone and the desktop beside them to show those didn't move. Every scene is seeded and stepped
// frame by frame, so two builds give the same fight and only the layout differs.
//
//   npm run build
//   node scripts/shots/portrait.mjs --out /tmp/after [--dist dist] [--only 390x844] [--shots close,walls]
//   node scripts/shots/portrait.mjs --sheet /tmp/before /tmp/after /tmp/sheet     (contact sheets, needs ImageMagick)
//   node scripts/shots/portrait.mjs --same /tmp/before /tmp/after                 (844x390 and 1280x720: pixel for pixel?)
//
// --check (with --out) also measures the layout at each upright size and exits 1 when something is off: the
// view inside the screen and as wide as it (inside the side insets: no dark bar at either side), the HUD band
// between the top buttons and the view, the controls under the view and whole, and both fighters inside the
// view in every fight shot. 395x700 and 412x640 are a phone with its browser's bars showing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const here = path.dirname(new URL(import.meta.url).pathname);

const SIZES = [
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '412x915', w: 412, h: 915, touch: true },
  { name: '375x667', w: 375, h: 667, touch: true },
  { name: '395x700', w: 395, h: 700, touch: true },
  { name: '412x640', w: 412, h: 640, touch: true },
  { name: '844x390', w: 844, h: 390, touch: true },
  { name: '1280x720', w: 1280, h: 720, touch: false },
];
// [name, query, how far to step]: ms, or a test in the page that says when (then a few frames more)
const SHOTS = [
  ['round-start', 'scene=play', { ms: 900 }],
  ['close', 'scene=ai-fight&p1=manager&p2=wellness', { ms: 2600 }],
  ['walls', 'scene=idle', { walls: true, ms: 2500 }],
  ['juggle', 'scene=juggle-test', { until: 'const u = g.sim.units[1]; return !u.grounded && (u.state === "knockdown" || u.state === "hitstun") && g.sim.combo && g.sim.combo.count >= 2', more: 8 }],
  ['splat', 'scene=wall-test', { until: 'return g.sim.units[1].state === "splat"', more: 6 }],
  ['ko', 'scene=ko', { until: 'return g.sim.phase === "ko"', more: 30 }],
  ['finisher', 'scene=perfect-test', { until: 'return g.sim.perfectT >= 0 && g.sim.perfectRel >= 0', more: 26 }],
  ['horde', 'scene=horde-ai', { ms: 14000 }],
  ['floor-break', 'scene=floor-break-test', { ms: 3000 }],
  ['stairs', 'scene=stair-test', { ms: 2600 }],
  ['botch', 'scene=botch-test', { ms: 700 }],
];
const FIGHTS = new Set(['round-start', 'close', 'walls', 'juggle', 'splat', 'horde', 'stairs', 'botch']);   // both fighters must be inside the frame

if (argv[0] === '--sheet') { sheet(argv[1], argv[2], argv[3]); process.exit(0); }
if (argv[0] === '--same') process.exit(same(argv[1], argv[2]));

const OUT = path.resolve(opt('--out', 'gauntlet/tmp/portrait'));
const root = path.resolve(opt('--dist', path.join(here, '../../dist')));
const ONLY = opt('--only', ''), PICK = opt('--shots', ''), CHECK = argv.includes('--check');
if (!fs.existsSync(path.join(root, 'stick-fight/play/index.html'))) { console.error('no build: run npm run build first'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/stick-fight/play/`;
const browser = await chromium.launch({ headless: true, executablePath, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const fail = (msg) => { bad++; console.log(`FAIL ${msg}`); };

// every random draw seeded the same in both builds (particles, rain, the attract pick)
const seedRandom = () => { let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

// the layout as the page has it, in CSS px (`square` is the view: what's visible of the canvas)
function measure() {
  const r = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return b.width && b.height ? { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, b: Math.round(b.bottom * 10) / 10, r: Math.round(b.right * 10) / 10 } : null; };
  const q = (s) => r(document.querySelector(s));
  const de = document.documentElement, cs = getComputedStyle(de);
  const sq = de.classList.contains('sq');
  const canvas = q('#game'), stage = q('#stage');
  // the view: the canvas less what's clipped off each side (--sq-clip of its width; a build from before the
  // variable crop always clipped 21.875%, a 720 square)
  const clip = parseFloat(cs.getPropertyValue('--sq-clip')), cl = Number.isFinite(clip) ? clip : 0.21875;
  const square = sq && canvas ? { x: canvas.x + canvas.w * cl, y: canvas.y, w: canvas.w * (1 - 2 * cl), h: canvas.h, b: canvas.b, r: canvas.r - canvas.w * cl } : null;
  const probe = document.querySelector('.tc-probe'), ps = probe ? getComputedStyle(probe) : null;
  const insets = { l: ps ? parseFloat(ps.paddingLeft) || 0 : 0, r: ps ? parseFloat(ps.paddingRight) || 0 : 0 };
  const g = /** @type {any} */ (window).__game;
  const frame = square || stage;
  const k = square ? square.h / 720 : stage.w / 1280, ox = square ? square.x - (1280 - square.w / k) / 2 * k : stage.x;
  const cam = g.camera;
  const units = g.sim.units.filter((u) => !u.hidden && u.rig && u.rig.joints && u.rig.joints.head).slice(0, 2).map((u) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const j = g.drawn ? g.drawn(u) : null, pts = j && j.all ? Object.values(j.all) : Object.values(u.rig.joints);
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const m = cam.mirror ? -1 : 1, sx = (wx) => ox + (m * (wx - cam.x - cam.shakeX) * cam.zoom + 640) * k, sy = (wy) => frame.y + ((wy - cam.y - cam.shakeY) * cam.zoom + 360) * k;
    const a = sx(x0), b = sx(x1);
    return { x0: Math.min(a, b), x1: Math.max(a, b), y0: sy(y0), y1: sy(y1), h: (y1 - y0) * cam.zoom * k };
  });
  return { sq, insets, vw: innerWidth, vh: innerHeight, scale: +cs.getPropertyValue('--tc-scale') || 1, stage, square, band: q('#hudband'), top: q('.tc-top'), cluster: q('.tc-cluster'), stick: q('.tc-base'),
    btn: q('.tc-l1'), guard: q('.tc-guard'), zoom: Math.round(cam.zoom * 1000) / 1000, units };
}
function checkLayout(tag, m, fight) {
  if (!m.sq) return fail(`${tag}: not in the square layout`);
  const s = m.square, e = 0.6;
  if (s.x < -e || s.r > m.vw + e || s.y < -e || s.b > m.vh + e) fail(`${tag}: the view leaves the screen (${JSON.stringify(s)})`);
  if (s.x > m.insets.l + e || s.r < m.vw - m.insets.r - e) fail(`${tag}: the view is narrower than the screen (${Math.round(s.x)}..${Math.round(s.r)} of 0..${m.vw}): a dark bar at the side`);
  if (!m.top || m.top.b > (m.band ? m.band.y : s.y) + e) fail(`${tag}: the top buttons overlap what's under them`);
  if (!m.band) fail(`${tag}: no HUD band`);
  else { if (m.band.b > s.y + e) fail(`${tag}: the HUD band overlaps the square (${m.band.b} > ${s.y})`); if (m.band.x < -e || m.band.r > m.vw + e) fail(`${tag}: the HUD band leaves the screen`); }
  for (const [name, c] of [['buttons', m.cluster], ['stick', m.stick]]) {
    if (!c) { fail(`${tag}: no ${name}`); continue; }
    if (c.y < s.b - e) fail(`${tag}: the ${name} overlap the square (${c.y} < ${s.b})`);
    if (c.x < -e || c.r > m.vw + e || c.b > m.vh + e) fail(`${tag}: the ${name} are cut off (${JSON.stringify(c)})`);
  }
  if (fight) for (const [i, u] of m.units.entries()) if (u.x0 < s.x - 1 || u.x1 > s.r + 1 || u.y0 < s.y - 1 || u.y1 > s.b + 1) fail(`${tag}: fighter ${i + 1} is outside the square (${Math.round(u.x0)}..${Math.round(u.x1)} x ${Math.round(u.y0)}..${Math.round(u.y1)} in ${Math.round(s.x)}..${Math.round(s.r)} x ${Math.round(s.y)}..${Math.round(s.b)})`);
}

const sizes = {};
for (const size of SIZES.filter((s) => !ONLY || ONLY.split(',').includes(s.name))) {
  const upright = size.touch && size.h > size.w;
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.touch ? 2 : 1, hasTouch: size.touch, isMobile: size.touch });
  await ctx.addInitScript(seedRandom);
  const open = async (q) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fail(`[${size.name}] page error: ${e.message}`));
    await page.goto(`${base}?${q}${q ? '&' : ''}tier=3`);
    await page.waitForFunction(() => window.__gauntlet && window.__gauntlet.ready, null, { timeout: 60000 });
    return page;
  };
  for (const [name, q, how] of SHOTS.filter((s) => !PICK || PICK.split(',').includes(s[0]))) {
    const page = await open(q);
    await page.evaluate(([q, how]) => {
      const g = window.__game, G = window.__gauntlet, s = new URLSearchParams(q).get('scene');
      G.setScene(s); g.fx.seed(1); g.fx.particles.clear(); g.arena.time = 0;
      const step = () => G.step(1000 / 60);
      if (how.walls) {
        const b = g.sim.viewBounds || g.sim.bounds, at = [b.x0 + 70, b.x1 - 70];   // the building's far walls
        g.sim.units.slice(0, 2).forEach((u, i) => { u.x = at[i]; u.rig.x = at[i]; u.rig.update(0); });
      }
      if (how.until) { const test = new Function('g', how.until); let n = 0; while (!test(g) && n++ < 3000) step(); for (let i = 0; i < (how.more || 0); i++) step(); }
      else for (let t = 0; t < how.ms; t += 1000 / 60) step();
    }, [q, how]);
    await sleep(150);
    await page.screenshot({ path: path.join(OUT, `${size.name}-${name}.png`) });
    if (CHECK && upright) { const m = await page.evaluate(measure); checkLayout(`[${size.name}] ${name}`, m, FIGHTS.has(name)); if (name === 'close' || name === 'walls') (sizes[size.name] ||= {})[name] = m; }
    await page.close();
  }
  if (!PICK || PICK.includes('menus')) {
    // the flow's screens: the title, the menus, a fight and its pause menu
    const page = await open('');
    await page.waitForFunction(() => window.__flow && window.__flow.state === 'attract' && document.fonts.status === 'loaded', null, { timeout: 30000 });
    const go = (s) => page.evaluate((st) => window.__flow.debug.go(st), s);
    const shot = async (name, wait = 700) => { await sleep(wait); await page.screenshot({ path: path.join(OUT, `${size.name}-${name}.png`) }); };
    await shot('title', 2500);
    await go('modeSelect'); await shot('mode-select');
    await page.evaluate(() => { const d = window.__flow.debug; d.sel.mode = 'training'; d.sel.step = 'player'; d.go('charSelect'); });
    await shot('select', 1000);
    await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.player));
    await sleep(600);
    await page.evaluate(() => window.__flow.debug.pickChar(window.__flow.debug.sel.dummy));
    await page.waitForFunction(() => window.__flow.state === 'fighting');
    await shot('fight', 2500);
    if (CHECK && upright) checkLayout(`[${size.name}] fight`, await page.evaluate(measure), true);
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__flow.state === 'paused');
    await shot('pause');
    await page.keyboard.press('F1'); await shot('move-list', 900); await page.keyboard.press('Escape'); await sleep(300);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:settings'))); await shot('settings', 1500);
    await page.close();
  }
  await ctx.close();
  console.log(`[${size.name}] done`);
}
await browser.close(); server.close();
if (CHECK) {
  console.log('\nsize      controls  top buttons  HUD band  view       crop  gap   controls   fighter close / apart');
  for (const [name, s] of Object.entries(sizes)) {
    const m = s.close || s.walls; if (!m) continue;
    const hOf = (x) => (x && x.units.length ? Math.round(Math.max(...x.units.map((u) => u.h))) : '?');
    if (!m.sq) { console.log(`${name.padEnd(9)} no square (an older build): stage ${Math.round(m.stage.w)}x${Math.round(m.stage.h)}, fighter ${hOf(s.close)} / ${hOf(s.walls)} px tall`); continue; }
    console.log(`${name.padEnd(9)} ${String(Math.round(m.scale * 100) + '%').padEnd(9)} ${String(Math.round(m.top.h)).padEnd(12)} ${String(Math.round(m.band.h)).padEnd(9)} ${`${Math.round(m.square.w)}x${Math.round(m.square.h)}`.padEnd(10)} ${String(Math.round(720 * m.square.w / m.square.h)).padEnd(5)} ${String(Math.round(m.cluster.y - m.square.b)).padEnd(5)} ${`${Math.round(m.cluster.w)}x${Math.round(m.cluster.h)}`.padEnd(10)} ${hOf(s.close)} / ${hOf(s.walls)} px tall`);
  }
  console.log(bad ? `\n${bad} problems` : '\nlayout ok, no page errors');
}
process.exit(bad ? 1 : 0);

function names(dir) { return fs.readdirSync(dir).filter((f) => f.endsWith('.png')); }
// before and after side by side, a sheet per size
function sheet(before, after, out) {
  fs.mkdirSync(out, { recursive: true });
  for (const size of SIZES) {
    const files = names(after).filter((f) => f.startsWith(size.name + '-'));
    if (!files.length) continue;
    const order = [...SHOTS.map((s) => s[0]), 'title', 'mode-select', 'select', 'fight', 'pause', 'move-list', 'settings'];
    files.sort((a, b) => order.indexOf(a.slice(size.name.length + 1, -4)) - order.indexOf(b.slice(size.name.length + 1, -4)));
    const cells = [];
    for (const f of files) {
      const label = f.slice(size.name.length + 1, -4), cell = path.join(out, `cell-${f}`);
      const b = path.join(before, f), a = path.join(after, f);
      const args = fs.existsSync(b) ? [b, a] : [a];
      execFileSync('magick', [...args, '-resize', size.h > size.w ? 'x560' : '560x', '-bordercolor', '#07020f', '-border', '6', '+append', '-background', '#07020f', '-fill', '#E85D00', '-font', 'Courier-Bold', '-pointsize', '20',
        '-gravity', 'north', '-splice', '0x34', '-annotate', '+0+6', `// ${label.toUpperCase().replace(/-/g, '_')}   ${fs.existsSync(b) ? 'before | after' : 'after'}`, cell]);
      cells.push(cell);
    }
    const dst = path.join(out, `sheet-${size.name}.png`);
    execFileSync('magick', ['montage', ...cells, '-tile', size.h > size.w ? '4x' : '2x', '-geometry', '+8+8', '-background', '#07020f', dst]);
    for (const c of cells) fs.unlinkSync(c);
    console.log(dst);
  }
}
// the sizes that mustn't change: how many pixels differ between the two builds
function same(before, after) {
  let off = 0;
  for (const size of SIZES.filter((s) => !(s.touch && s.h > s.w))) for (const f of names(after).filter((n) => n.startsWith(size.name + '-'))) {
    if (!fs.existsSync(path.join(before, f))) continue;
    let n = '0';
    try { execFileSync('magick', ['compare', '-metric', 'AE', path.join(before, f), path.join(after, f), 'null:'], { stdio: 'pipe' }); } catch (e) { n = String(e.stderr || '').trim().split(' ')[0]; }
    if (n !== '0') off++;
    console.log(`${f.padEnd(34)} ${n === '0' ? 'identical' : `${n} pixels differ`}`);
  }
  return off ? 1 : 0;
}
