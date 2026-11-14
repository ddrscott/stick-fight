#!/usr/bin/env node
// Every screen of the flow, at every shape the game runs in, screenshotted and checked (README, Arcade flow, Menus,
// "Held upright: every screen"). For a before/after of anything that touches a menu's layout.
//
//   npm run dev:worker & npx vite --port 8191 &       (the game, with ./api proxied to a local Worker)
//   node scripts/shots/menus.mjs [--out dir] [--url http://127.0.0.1:8191/play/] [--only upright|sideways|desktop|<size>,...]
//                                [--states crewLobby,onlineHost,...|local] [--no-net] [--check] [--jobs n]
//
// The tour, crew screens first: crewCreate, crewJoin, crewLobby (a long member list, then with PLAY pressed),
// crewLinking, the NO CREW AT THAT LINK notice; then the online menu, profile, name and sign-in screens, onlineHost
// (its QR read back with jsQR from the screenshot), onlineJoin, onlineConnecting and NO ROOM WITH THAT CODE, a real
// room with a rival page (onlineSelect, the LEAVE confirm, onlinePost, the rival leaving), the LIVE list and the
// watch view; then the title, SETTINGS (each tab), mode select, character select, high scores, an arcade run
// (stage card, pause, pause panel, MOVE LIST, stage clear, continue, game over, initials, the table, the ending
// and its table; the game is run ahead with __game.advance, never waited on) and the
// home-screen how-to and the update pill. The crew and room screens need the Worker: a page URL whose ../api/
// reaches it (Vite proxies it; SF_WORKER=http://127.0.0.1:<port> points the proxy at another port).
//
// For each screen it reports, and --check exits 1 on: anything a player reads or presses that is cut off by the
// screen (or the stage, for screens that live in it) or by its box at the side, running past a bordered box, in a
// box that scrolls sideways, overlapping another, or under the top buttons, the HUD band or the touch controls; text
// under 12 CSS px at every size; and, held upright only, tap targets under 40 px tall. Lists that
// scroll (data-scroll) are judged by their box, not their rows. Pictures go to --out (default gauntlet/tmp/shots;
// with --check, only when --out is given), named <size>-<nn>-<state>.png.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CHECK = argv.includes('--check');
const OUT = opt('--out', CHECK ? '' : 'gauntlet/tmp/shots');
const URL_ = opt('--url', 'http://127.0.0.1:8191/play/');
const API = new URL('../api/', URL_).toString();
const NET = !argv.includes('--no-net');
const ONLY = opt('--only', '').split(',').filter(Boolean);
const STATES = opt('--states', '').split(',').filter(Boolean);
const TEXT_MIN = 12, TAP_MIN = 40;
// --dump file.json: every element's box, font size and text on every screen, to diff two builds (sideways and
// desktop must not move by a pixel; screenshots can't show that, the demo fight behind the menus never holds still)
const DUMP = opt('--dump', '');
const dump = {};
function layout() {
  const out = [];
  const sel = ['#flow', '.sf-panel.sf-open', '.ml-root', '.nf-lobby:not([hidden])', '.up-pill:not([hidden])', '.sf-hs'];
  for (const q of sel) for (const root of document.querySelectorAll(q)) {
    const walk = (n, path) => {
      const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
      if (cs.display === 'none') return;
      const own = [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join('').slice(0, 30);
      out.push(`${path} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)} ${cs.fontSize} z${n.currentCSSZoom || 1}${own ? ' "' + own + '"' : ''}`);
      [...n.children].forEach((c, i) => walk(c, `${path}>${c.tagName.toLowerCase()}${typeof c.className === 'string' && c.className ? '.' + c.className.trim().split(/\s+/).filter((k) => !/^fl-(focus|hit|dis|cur)$/.test(k)).join('.') : ''}[${i}]`));
    };
    walk(root, q);
  }
  return out;
}

const phone = (w, h) => ({ name: w > h ? `sideways-${w}x${h}` : `upright-${w}x${h}`, viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, upright: h > w });
const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false, upright: false },
  phone(844, 390), phone(667, 375),
  phone(390, 844), phone(412, 915), phone(375, 667), phone(395, 700), phone(412, 640),
].filter((s) => !ONLY.length || ONLY.some((o) => s.name === o || s.name.startsWith(o + '-') || s.name.endsWith(o)));

if (OUT) fs.mkdirSync(OUT, { recursive: true });
const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'];
const browser = await chromium.launch({ headless: true, executablePath, args: GPU });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, every = 150) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };
let bad = 0;
const problems = [];

// ---- the audit, run in the page ---------------------------------------------------------------------------------
function audit({ upright, textMin, tapMin }) {
  const out = [];
  const vw = innerWidth, vh = innerHeight;
  const vis = (n) => { const cs = getComputedStyle(n); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.02; };
  const shown = (n) => { for (let e = n; e && e !== document.documentElement; e = e.parentElement) if (!vis(e)) return false; return true; };
  const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const cut = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const area = (a) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
  const name = (n) => `${(n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : n.tagName.toLowerCase())} "${(n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22)}"`;
  const fmt = (a) => `${Math.round(a.l)},${Math.round(a.t)} ${Math.round(a.r - a.l)}x${Math.round(a.b - a.t)}`;
  const screen = { l: 0, t: 0, r: vw, b: vh };

  // what's on screen to check: the flow's screen, and whichever overlay is up
  const roots = [];
  const flow = document.getElementById('flow');
  const scr = flow && flow.querySelector(':scope > .fl-screen');
  const full = flow && getComputedStyle(flow).position === 'fixed';
  // a screen in the 16:9 box can use the whole view it's drawn in: held upright the view runs past the box (--sq-over)
  const stage = R(document.getElementById('stage').getBoundingClientRect());
  const over = document.documentElement.classList.contains('sq') ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sq-over')) || 0) * (stage.b - stage.t) : 0;
  if (scr) roots.push({ root: scr, box: full ? screen : cut({ l: stage.l, r: stage.r, t: stage.t - over, b: stage.b + over }, screen) });
  for (const sel of ['.sf-panel.sf-open', '.ml-root', '.nf-lobby:not([hidden]) .nf-panel', '.sf-hs', '.up-pill:not([hidden])', '#credits'])
    for (const n of document.querySelectorAll(sel)) if (shown(n) && n.getBoundingClientRect().width) roots.push({ root: n, box: screen, overlay: true });
  const overlayUp = roots.some((r) => r.overlay && !r.root.matches('.up-pill, #credits'));

  // what nothing may sit under: the corner buttons, the HUD band in a fight, the touch controls where they show
  const blockers = [];
  for (const n of document.querySelectorAll('.tc-top .tc-mini, .sf-corner button, .tc-cluster .tc-btn, .tc-cluster .tc-sm, .tc-base'))
    if (shown(n) && n.getBoundingClientRect().width) blockers.push({ n, a: R(n.getBoundingClientRect()) });
  const band = document.getElementById('hudband');
  if (band && shown(band) && document.documentElement.classList.contains('fl-hud')) blockers.push({ n: band, a: R(band.getBoundingClientRect()) });

  const items = [];
  for (const { root, box, overlay } of roots) {
    if ((!overlay || root.matches('#credits')) && overlayUp) continue;   // a screen under an open overlay isn't being read (nor the title's credits link)
    const all = [root, ...root.querySelectorAll('*')];
    for (const n of all) {
      if (n.closest('.lg-bar') && !document.documentElement.matches('.dev-key, .dev-pad')) continue;
      if (n.closest('.sf-tcview')) continue;   // SETTINGS, CONTROLS: a scaled-down picture of the touch controls, not controls
      const press = n.matches('button, .fl-btn, .nf-btn, [role="button"], input, .fl-slot b') && !n.matches('.fl-off');
      const text = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!press && !text) continue;
      if (!shown(n)) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // inside a box that scrolls (or the carousel), a row may be out of view: judge by the box
      const sc = n.parentElement && n.parentElement.closest('[data-scroll], .fl-ring, .fl-roll');
      const scr = sc && root.contains(sc) ? R(sc.getBoundingClientRect()) : null;
      let a = R(r);
      if (scr) { a = cut(a, scr); if (area(a) <= 0) continue; }
      // what a box with overflow hidden (a name cut with an ellipsis) doesn't show isn't there; but a
      // box that cuts something off at its side, with no ellipsis to say so, has cut it off
      for (let e = n.parentElement; e && e !== root.parentElement; e = e.parentElement) {
        const o = getComputedStyle(e);
        if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const eb = R(e.getBoundingClientRect()), was = a;
        a = cut(a, eb);
        // (a flex or grid box's ellipsis is for its own text only: a child it clips, like a READY chip after a name, is cut off)
        const flexed = /flex|grid/.test(o.display);
        const ellipsis = getComputedStyle(n).textOverflow === 'ellipsis' || (o.textOverflow === 'ellipsis' && !flexed) || !!e.closest('.fl-ring, .fl-roll');   // (the carousel's side cards are shrunk and half off screen by design)
        if (!ellipsis && (area(a) > 0 || flexed) && (was.l < eb.l - 1 || was.r > eb.r + 1)) out.push(`CUT OFF AT THE SIDE ${name(n)} ${fmt(was)} (in ${fmt(eb)})`);
        // and one that cuts it at the top or bottom, unless it scrolls there
        const scrolls = /auto|scroll/.test(o.overflowY) || !!e.closest('.fl-ring, .fl-roll');
        if (!scrolls && area(a) > 0 && (was.t < eb.t - 1 || was.b > eb.b + 1)) out.push(`CUT OFF ${name(n)} ${fmt(was)} (in ${fmt(eb)})`);
      }
      if (area(a) <= 0) continue;
      // text is judged by the glyphs' own box, not its element's (padding, a fixed-width cell)
      let ta = null;
      if (text && !press) {
        const rg = document.createRange(); let u = null;
        for (const c of n.childNodes) if (c.nodeType === 3 && c.textContent.trim()) { rg.selectNodeContents(c); const q = R(rg.getBoundingClientRect()); u = u ? { l: Math.min(u.l, q.l), t: Math.min(u.t, q.t), r: Math.max(u.r, q.r), b: Math.max(u.b, q.b) } : q; }
        if (u) {
          // letters taller than the box that clips them are cut (a grid row squeezed under its text)
          // (against the font size: a font's line box runs well past its capitals, Teko's by 40%)
          const fpx = parseFloat(getComputedStyle(n).fontSize) * (n.currentCSSZoom || 1);
          if (/hidden|clip/.test(getComputedStyle(n).overflowY) && r.height < fpx * 0.85) out.push(`CUT OFF ${name(n)}: ${Math.round(fpx)} px letters in a ${Math.round(r.height)} px box`);
          ta = cut(u, a); if (area(ta) <= 0) continue;   // clipped text (an ellipsis) ends at its box
          // the letters, not the line box: a glyph range is the font's whole ascent to descent (Bungee's is half again
          // its capitals), so it's narrowed to the middle 0.8 em, where capitals and digits sit
          const mid = (ta.t + ta.b) / 2, half = Math.min((ta.b - ta.t) / 2, fpx * 0.4);
          ta = { l: ta.l, r: ta.r, t: mid - half, b: mid + half };
        }
      }
      // text that runs past the bordered box it sits in (a table wider than its panel), or a box that hides what it
      // can't fit sideways with no ellipsis to say so (it would scroll sideways, which nothing here should)
      if (ta && !n.closest('.fl-ring, .fl-roll, .sf-tcview')) {
        for (let e = n.parentElement; e && e !== root.parentElement; e = e.parentElement) {
          const o = getComputedStyle(e);
          if (!(parseFloat(o.borderLeftWidth) > 0 && parseFloat(o.borderRightWidth) > 0)) continue;
          const eb = R(e.getBoundingClientRect());
          if (ta.l < eb.l - 1 || ta.r > eb.r + 1) out.push(`RUNS PAST ITS BOX ${name(n)} ${fmt(ta)} (in ${fmt(eb)})`);
          break;
        }
      }
      items.push({ n, a: ta || a, box: box, press, text, scr, sc });
    }
  }
  const owners = new Set(items.map((i) => i.n));
  // a box that scrolls sideways (or hides what runs past its side): every list here scrolls up and down only
  for (const { root } of roots) for (const e of [root, ...root.querySelectorAll('*')]) {
    if (!shown(e) || e.closest('.fl-ring, .fl-roll, .sf-tcview, .fl-ringdots, [data-scroll="x"]')) continue;   // (a strip made to scroll sideways, like the move list's tabs, is fine)
    const o = getComputedStyle(e);
    if (o.overflowX === 'visible' || o.textOverflow === 'ellipsis' || o.whiteSpace === 'nowrap' && o.textOverflow === 'ellipsis') continue;
    if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && [...e.querySelectorAll('*')].some((k) => shown(k) && k.getBoundingClientRect().right > e.getBoundingClientRect().right + 2 && [...k.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && getComputedStyle(k).textOverflow !== 'ellipsis'))
      out.push(`SCROLLS SIDEWAYS ${name(e)} ${e.scrollWidth} in ${e.clientWidth}`);
  }
  // a box that scrolls with rows hidden past its bottom edge must say so: src/scrollcue.js fades the edge (sc-more),
  // so a cut-off list never reads as the end of the page (round 2 of [t55b8f]: SETTINGS showed no sign it scrolled)
  for (const e of document.querySelectorAll('[data-scroll="y"]')) {
    if (!shown(e) || e.clientHeight < 20) continue;
    const room = e.scrollHeight - e.clientHeight;
    if (room > 4 && e.scrollTop < room - 2 && !e.classList.contains('sc-more')) out.push(`NO SCROLL CUE ${name(e)} ${e.scrollHeight} in ${e.clientHeight}`);
  }
  // is the blocker drawn over the item where they meet (an open panel covers the corner buttons, not the other way)
  function above(bl, n, c) {
    const st = document.elementsFromPoint((c.l + c.r) / 2, (c.t + c.b) / 2);
    const ib = st.findIndex((e) => bl.contains(e) || e === bl), ii = st.findIndex((e) => n.contains(e) || e === n || e.contains(n));
    return ib >= 0 && (ii < 0 || ib < ii);
  }
  for (const it of items) {
    const { n, a, box } = it;
    const chk = it.scr || a;
    if (chk.l < box.l - 1 || chk.t < box.t - 1 || chk.r > box.r + 1 || chk.b > box.b + 1) out.push(`CUT OFF ${name(n)} ${fmt(chk)} (in ${fmt(box)})`);
    for (const bl of blockers) if (!bl.n.contains(n) && area(cut(a, bl.a)) > 4 && above(bl.n, n, cut(a, bl.a))) out.push(`UNDER ${bl.n.id || bl.n.className.split(' ')[0]} ${name(n)} ${fmt(a)}`);
    // the 12 px floor holds at every size: upright, sideways and on a desktop (README, Menus, "Text floors")
    if (it.text && !n.closest('.sf-tcview')) {
      const z = n.currentCSSZoom || 1;
      const px = parseFloat(getComputedStyle(n).fontSize) * z;
      if (px < textMin - 0.25) out.push(`TEXT ${px.toFixed(1)}px ${name(n)}`);
    }
    if (upright) {
      if (it.press && !it.n.matches('.fl-slot b') && (r => r.height < tapMin - 0.5)(n.getBoundingClientRect()) && !(n.parentElement && owners.has(n.parentElement) && n.parentElement.matches('button, .fl-btn')))
        out.push(`TAP ${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)} ${name(n)}`);
    }
  }
  // what a screen asks is always in view (round 3 of [t55b8f]: STAGE CLEAR's NEXT STAGE and CONTINUE?'s YES sat below the
  // fold of a screen that scrolled as a whole). Every button of the flow's screen that isn't a row of a list that scrolls
  // in its own box has to be inside the view as the screen opens, and so does its legend when it has one: on every screen
  // that decides what's next (a result, a countdown, the pause menu, the stage card, the online post-match); on the rest
  // (a long MAIN MENU on a short phone, the closet) the button the screen opens on.
  const ui = window.__flow && window.__flow.debug.ui;
  if (ui && scr && !overlayUp) {
    const view = cut(roots[0].box, screen);
    // (the table after a game is one too: TITLE and MAIN MENU are where the run goes next)
    const postGame = scr.matches('.fl-scores') && !!(window.__flow.debug.hs || {}).postGame;
    const decides = postGame || scr.matches('.fl-clear, .fl-continue, .fl-gameover, .fl-ending, .fl-pause, .fl-stage, .fl-post, .fl-onlineend, .fl-initials') || !!scr.querySelector('[data-squeeze]');
    for (const [k, it] of ui.items.entries()) {
      if (!decides && k !== ui.focus) continue;
      const e = it.el;
      if (!shown(e) || e.offsetParent === null) continue;
      // on a screen that decides, every button is in the view, inside a box that scrolls or not ([t6z5am]); on the
      // rest, the button the screen opens on, unless it's a row of a list that scrolls in its own box
      const inner = e.parentElement && e.parentElement.closest('[data-scroll], .fl-ring');
      if (!decides && inner && inner !== scr) continue;
      const a = R(e.getBoundingClientRect());
      if (!a.r || a.t < view.t - 1 || a.b > view.b + 1) out.push(`OUT OF VIEW ${name(e)} ${fmt(a)} (view ${fmt(view)})`);
    }
    const lg = scr.querySelector(':scope > .lg-bar');
    if (lg && document.documentElement.matches('.dev-key, .dev-pad') && !shown(lg)) out.push('LEGEND HIDDEN (the screen scrolls as a whole)');
  }
  // a bordered box (a panel, a list's frame) under a corner button: its edge reads as cut (round 3: the pause screen's
  // TECHNIQUES box under the fullscreen pill at 667x375)
  for (const { root, overlay } of roots) {
    if (overlay || overlayUp) continue;
    for (const e of root.querySelectorAll('*')) {
      if (!shown(e) || e.closest('.lg-bar, .sf-tcview')) continue;
      const o = getComputedStyle(e);
      if (!(parseFloat(o.borderTopWidth) > 0 && parseFloat(o.borderRightWidth) > 0 && parseFloat(o.borderLeftWidth) > 0)) continue;
      const a = R(e.getBoundingClientRect());
      if (!area(a)) continue;
      for (const bl of blockers) if (!bl.n.contains(e) && bl.n.closest('.sf-corner, .tc-top') && area(cut(a, bl.a)) > 4) out.push(`BOX UNDER ${bl.n.className.split(' ')[0] || bl.n.tagName} ${name(e)} ${fmt(a)}`);
    }
  }
  // an on-screen keyboard's keys share a row height, the wide ones (DEL, ENTER) included ([t6z5am]: the character
  // select's .fl-wide padding reached the keyboard's DEL and ENTER, which grew taller with their labels at the top)
  for (const row of document.querySelectorAll('#flow .fl-kbrow')) {
    if (!shown(row)) continue;
    const hs = [...row.children].filter(shown).map((k) => [k, k.getBoundingClientRect().height]);
    const h0 = Math.min(...hs.map(([, h]) => h));
    for (const [k, h] of hs) if (h > h0 + 1) out.push(`KEY TALLER THAN ITS ROW ${name(k)} ${Math.round(h)} px (row ${Math.round(h0)} px)`);
  }
  // overlaps: two things a player reads or presses, neither inside the other, drawn over each other
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j];
    if (A.n.contains(B.n) || B.n.contains(A.n)) continue;
    // the carousel's side cards sit under its arrows by design (README, Character select)
    if (A.n.closest('.fl-ring') && B.n.closest('.fl-ring')) continue;
    if ((A.n.matches('.fl-ringstep') && B.n.closest('.fl-ring')) || (B.n.matches('.fl-ringstep') && A.n.closest('.fl-ring'))) continue;
    const c = cut(A.a, B.a);
    // (a font's line box runs past its letters, so two lines of text may touch by a few px without the letters meeting)
    const slack = A.press || B.press ? 2 : 5;
    if (c.r - c.l > 2 && c.b - c.t > slack) out.push(`OVERLAP ${name(A.n)} ${fmt(A.a)} / ${name(B.n)} ${fmt(B.a)}`);
  }
  return [...new Set(out)];
}

// ---- the D-pad reaches every button: from the focus a screen opens on, every direction from every item reached ----
function reach() {
  if (document.querySelector('.sf-panel.sf-open, .ml-root, .nf-lobby:not([hidden]) .nf-panel')) return [];   // an overlay has the keys
  const f = window.__flow, ui = f && f.debug.ui;
  if (!ui || ui.items.length < 2 || ui.focus < 0) return [];
  const items = ui.items, start = ui.focus, seen = new Set([start]), q = [start];
  const live = (k) => !items[k].el.classList.contains('fl-dis') && items[k].el.offsetParent !== null;
  while (q.length) {
    const k = q.shift();
    for (const d of ['up', 'down', 'left', 'right']) { ui.setFocus(k); ui.move(d); if (!seen.has(ui.focus)) { seen.add(ui.focus); q.push(ui.focus); } }
  }
  ui.setFocus(start);
  return items.map((it, k) => k).filter((k) => live(k) && !seen.has(k)).map((k) => `PAD CAN'T REACH "${(items[k].el.textContent || '').trim().slice(0, 24)}"`);
}

// ---- crews and rooms through the Worker, from Node ---------------------------------------------------------------
async function api(p, body) {
  const r = await fetch(API + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json().catch(() => null);
}
const NAMES = ['ALICE', 'BOB', 'CAROL', 'DMITRI', 'EVELYN', 'FRANKIE', 'GRACE', 'HAKIM', 'IRENE', 'JUNE', 'KWAME', 'LUCIA', 'MARGUERITE'];
/** members held in a crew by open sockets (a lobby that has filled up), each with a fixed id */
function members(slug, names, tag) {
  const socks = names.map((name, i) => {
    const ws = new WebSocket(API.replace(/^http/, 'ws') + `crews/${slug}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', pid: (tag + i.toString(16)).padEnd(32, '0'), name }));
    ws.onerror = () => {};
    return ws;
  });
  return { socks, close: () => socks.forEach((s) => { try { s.close(); } catch { /* gone */ } }) };
}

const player = (name, crews = []) => JSON.stringify({ id: 'a'.repeat(32), name, email: '', crews });

// ---- the tour ----------------------------------------------------------------------------------------------------
// Sizes run side by side with --jobs n (each in its own browser context). The default is one at a time when the tour
// goes online, since the local Worker caps joins and rooms a minute per IP, and 4 for --no-net.
const JOBS = Math.max(1, Number(opt('--jobs', NET ? 1 : 4)) || 1);
const t0 = Date.now();
async function tour(size) {
  const tz = Date.now();
  const ctxOpts = { viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor, hasTouch: size.hasTouch, isMobile: size.isMobile };
  const ctx = await browser.newContext(ctxOpts);
  const tag = size.name.replace(/\D/g, '').slice(0, 8).padStart(8, '0');
  let n = 0;
  let page = null;
  const report = (state, lines) => { for (const l of lines) { bad++; problems.push(`[${size.name}] ${state}: ${l}`); console.log(`[${size.name}] ${state}: ${l}`); } };
  const want = (s) => !STATES.length || STATES.includes(s);

  async function open(url, init) {
    if (page) await page.close();
    page = await ctx.newPage();
    page.on('pageerror', (e) => { bad++; console.log(`[${size.name}] page error: ${e.message}`); });
    await page.addInitScript((kv) => { localStorage.clear(); for (const k in kv) localStorage.setItem(k, kv[k]); }, init);
    await page.goto(url);
    await page.waitForFunction(() => window.__flow && window.__flow.state !== 'off' && document.fonts.status === 'loaded', null, { timeout: 30000 });
    await sleep(900);
  }
  const go = (...s) => page.evaluate((list) => { for (const x of list) window.__flow.debug.go(x); }, s);
  const state = () => page.evaluate(() => window.__flow.state);
  const at = (s, ms = 15000) => until(() => page.evaluate((x) => window.__flow.state === x, s), ms);
  // typing on the keyboard turns the key legend on; a phone shows the screen as touch left it
  const touchMode = () => size.hasTouch && page.evaluate(() => { const c = document.documentElement.classList; c.remove('dev-key', 'dev-pad', 'pad-ps'); c.add('dev-touch'); });
  /** check the screen that's up and take its picture */
  const shot = async (label, wait = 500, p = page) => {
    await sleep(wait);
    if (p === page) await touchMode();
    if (DUMP) dump[`${size.name} ${label}`] = await p.evaluate(layout);
    report(label, await p.evaluate(audit, { upright: size.upright, textMin: TEXT_MIN, tapMin: TAP_MIN }));
    const file = OUT ? path.join(OUT, `${size.name}-${String(++n).padStart(2, '0')}-${label}.png`) : '';
    if (file) await p.screenshot({ path: file });
    // after the picture: walking the focus around leaves buttons mid-fade
    if (!/charSelect|onlineSelect/.test(label)) report(label, await p.evaluate(reach));   // (the carousel and grid move by their own rules; test:select walks them)
    return file;
  };
  /** the QR on screen, read back from a screenshot by a separate decoder (jsQR), at the size it's drawn */
  async function readQR(label) {
    const tile = await page.$('#flow .fl-qrtile');
    if (!tile) { report(label, ['QR: no tile']); return; }
    const box = await tile.boundingBox();
    if (!size.upright) return;   // (sideways the tile is sized to the 16:9 stage, as before: 120 to 135 px on a phone)
    if (box.width < 140) report(label, [`QR: ${Math.round(box.width)} px, under 140`]);
    // a phone camera sees the screen at its real pixels: take it at 1x CSS px, the worst case
    const buf = await page.screenshot({ clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 }, scale: 'css' });
    const got = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      return window.__jsQR ? (window.__jsQR(d.data, d.width, d.height) || {}).data || '' : 'NO DECODER';
    }, buf.toString('base64'));
    const link = await page.evaluate(() => (document.querySelector('#flow .fl-link') || {}).textContent || '');
    if (got !== link) report(label, [`QR: read "${got}", the link is "${link}"`]);
    else console.log(`[${size.name}] ${label}: QR ${Math.round(box.width)} px reads back as the link`);
  }
  const jsqr = fs.readFileSync(require.resolve('jsqr/dist/jsQR.js'), 'utf8');
  const withDecoder = () => page.addScriptTag({ content: `(function(){var module={exports:{}},exports=module.exports;${jsqr};var m=module.exports;window.__jsQR=typeof m==='function'?m:(m.default||window.jsQR);})();` });

  const crewsList = [{ slug: 'tuesday-crew-7k2qm', name: 'TUESDAY CREW' }, { slug: 'lunch-crew-abcde', name: 'LUNCH CREW' }, { slug: 'the-night-shift-xyzwv', name: 'THE NIGHT SHIFT' }];

  // ---- crew rooms first ----
  if (NET) {
    const made = await api('crews', { name: 'TUESDAY NIGHT CREW' });
    const slug = made && made.slug;
    if (!slug) report('crew', [`no crew room from ${API}crews: is the Worker up?`]);
    await open(URL_, { 'stick-fight-player': player('SCOTT', crewsList) });
    if (want('crewCreate')) { await go('modeSelect', 'onlineMenu', 'crewCreate'); await page.keyboard.type('LUNCH CREW'); await shot('crewCreate'); await go('onlineMenu'); }
    if (want('crewJoin')) { await go('crewJoin'); await page.keyboard.type('tuesday-crew-7k2qm'); await shot('crewJoin'); await go('onlineMenu'); }
    if (slug && (want('crewLobby') || want('crewLinking'))) {
      const crowd = members(slug, NAMES.slice(0, 12), tag);
      await sleep(800);
      await open(URL_ + `?crew=${slug}`, { 'stick-fight-player': player('SCOTT', crewsList) });
      await at('crewLobby');
      await until(() => page.evaluate(() => document.querySelectorAll('.fl-standings .fl-sname').length > 5));
      await withDecoder();
      await shot('crewLobby');
      if (size.upright) {
        // upright the link and its QR code wait behind INVITE (README, Crew rooms, The lobby held upright)
        await page.evaluate(() => { const it = window.__flow.debug.ui.items.find((i) => i.el.classList.contains('fl-invite')); it && it.act(); });
        await shot('crewLobby-invite');
        await readQR('crewLobby-invite');
        await page.evaluate(() => { const it = window.__flow.debug.ui.items.find((i) => i.el.classList.contains('fl-invite')); it && it.act(); });
        await page.evaluate(() => window.__flow.debug.ui.setFocus(0));   // (DONE leaves the focus on INVITE; PLAY is next)
        await sleep(200);
      } else await readQR('crewLobby');
      await page.evaluate(() => window.__flow.debug.ui.activate());   // PLAY: waiting for a rival
      await shot('crewLobby-ready');
      // a member presses PLAY too: the crew pairs us, and the rival never connects, so the linking screen stays up
      crowd.socks[0].send(JSON.stringify({ t: 'play', on: true }));
      if (await at('crewLinking', 8000)) await shot('crewLinking', 300);
      else report('crewLinking', ['never got there']);
      crowd.close();
    }
    if (want('crewLobby')) {
      await open(URL_ + '?crew=gone-crew-abcde', { 'stick-fight-player': player('SCOTT') });
      await until(() => page.evaluate(() => !!document.querySelector('.fl-crewfail')));
      await shot('crewLobby-expired');
    }
  }

  // ---- online ----
  if (NET) {
    await open(URL_, { 'stick-fight-player': player('SCOTT', crewsList) });
    if (want('onlineMenu')) { await go('modeSelect', 'onlineMenu'); await shot('onlineMenu', 900); }
    if (want('profile')) { await go('modeSelect', 'onlineMenu', 'profile'); await shot('profile'); }
    if (want('nameEntry')) {
      await go('modeSelect', 'onlineMenu', 'profile');
      await page.evaluate(() => { const it = window.__flow.debug.ui.items.find((i) => /CHANGE NAME/.test(i.el.textContent)); it && it.act(); });
      if (await at('nameEntry', 3000)) await shot('nameEntry'); else report('nameEntry', ['never got there']);
    }
    if (want('signInEmail') || want('signInCode')) {
      await go('modeSelect', 'onlineMenu', 'profile');
      await page.evaluate(() => { const it = window.__flow.debug.ui.items.find((i) => /SAVE MY PROFILE/.test(i.el.textContent)); it && it.act(); });
      // the age question comes first (13 OR OLDER goes on to the email; UNDER 13 is pictured at the end)
      if (await at('ageCheck', 3000)) {
        await shot('ageCheck');
        await page.evaluate(() => { const it = window.__flow.debug.ui.items.find((i) => /13 OR OLDER/.test(i.el.textContent)); it && it.act(); });
      } else report('ageCheck', ['never got there']);
      if (await at('signInEmail', 3000)) {
        await page.keyboard.type(`scott.${tag}.${Date.now() % 100000}@example.com`);
        await shot('signInEmail');
        await page.keyboard.press('Enter');
        // (the local Worker caps code sends per IP an hour: past that the screen says so, and the code screen is opened directly)
        if (!(await at('signInCode', 8000))) await go('signInCode');
        if (await at('signInCode', 2000)) await shot('signInCode', 700); else report('signInCode', ['never got there']);
      } else report('signInEmail', ['never got there']);
      if (want('ageCheck')) {   // UNDER 13: no email, the profile stays here
        await go('modeSelect', 'onlineMenu', 'profile', 'ageCheck');
        await page.evaluate(() => { const it = window.__flow.debug.ui.items.find((i) => /UNDER 13/.test(i.el.textContent)); it && it.act(); });
        await shot('ageCheck-under13');
        await page.evaluate(() => localStorage.removeItem('stick-fight-age'));
      }
    }
    if (want('onlineHost')) {
      await go('modeSelect', 'onlineMenu', 'onlineHost');
      await until(() => page.evaluate(() => /^[A-Z0-9]{4}$/.test((document.querySelector('.fl-host .fl-h1') || {}).textContent || '')));
      await withDecoder();
      await shot('onlineHost');
      await readQR('onlineHost');
      await go('onlineMenu');
    }
    if (want('onlineJoin')) { await go('modeSelect', 'onlineMenu', 'onlineJoin'); await page.keyboard.type('K7Q'); await shot('onlineJoin'); }
    if (want('onlineConnecting') || want('onlineEnd')) {
      await go('modeSelect', 'onlineMenu', 'onlineJoin');
      await page.keyboard.type('ZZZZ');
      await page.evaluate(() => window.__flow.debug.go('onlineConnecting'));
      await shot('onlineConnecting', 150);
      if (await at('onlineEnd', 10000)) await shot('onlineEnd-noroom'); else report('onlineEnd', ['NO ROOM WITH THAT CODE never showed']);
    }
    if (['onlineSelect', 'onlineFighting', 'onlinePost', 'onlineEnd'].some(want)) {
      // A real room with a second browser. The local Worker caps WebSocket joins at 30 a minute per IP, and the crew
      // steps above open a dozen, so a match that drops (CONNECTION LOST on both) gets one more try after a pause.
      let failed = [];
      const fail = (st, lines) => { failed.push([st, lines]); };
      const room = async () => {
        // a rival hosts on a desktop page; we join its code
        const rctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await rctx.addInitScript(() => { localStorage.clear(); localStorage.setItem('stick-fight-player', JSON.stringify({ id: 'b'.repeat(32), name: 'BOB', email: '', crews: [] })); });
        const R = await rctx.newPage();
        await R.goto(URL_);
        await R.waitForFunction(() => window.__flow && window.__flow.state === 'attract');
        await R.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
        let code = await until(() => R.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null));
        if (!code) {   // the room didn't open (the local Worker's 10 new rooms a minute): wait it out and host again
          await sleep(30000);
          await R.evaluate(() => { const f = window.__flow.debug; f.go('onlineMenu'); f.go('onlineHost'); });
          code = await until(() => R.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null));
        }
        await go('modeSelect', 'onlineMenu', 'onlineJoin');
        for (let k = 0; k < 4; k++) await page.keyboard.press('Backspace');   // the code typed last time is still there
        await page.keyboard.type(String(code || 'ZZZZ'));
        await page.evaluate(() => window.__flow.debug.go('onlineConnecting'));
        if (await at('onlineSelect', 20000)) {
          await shot('onlineSelect', 900);
          // both lock in; the host starts at once
          await page.evaluate(() => window.__net.pick && window.__net.pick(window.__flow.debug.sel.player, true));
          await R.evaluate(() => { window.__net.pick && window.__net.pick(window.__flow.debug.sel.player, true); });
          await until(() => R.evaluate(() => { window.__net.pick && window.__net.pick(window.__flow.debug.sel.player, true); window.__net.startNow && window.__net.startNow(); return window.__flow.state === 'onlineFighting'; }), 15000);
          if (await at('onlineFighting', 10000)) {
            await sleep(1500);
            await shot('onlineFighting', 300);
            await page.keyboard.press('Escape');
            await shot('onlineFighting-leave', 400);
            await page.keyboard.press('Escape');
            // a common stop frame on both, then the same KO on both, round after round until the match is over
            for (let k = 0; k < 6 && (await state()) === 'onlineFighting'; k++) {
              const f = (await page.evaluate(() => window.__net.netcode.frame)) + 60;
              await page.evaluate((x) => { window.__net.haltAt(x); }, f); await R.evaluate((x) => { window.__net.haltAt(x); }, f);
              await until(() => page.evaluate((x) => window.__net.netcode.frame >= x, f), 10000);
              await until(() => R.evaluate((x) => window.__net.netcode.frame >= x, f), 10000);
              await sleep(600);   // every frame up to the halt confirmed on both
              const ko = await page.evaluate(() => window.__flow.debug.debugKO(1)); await R.evaluate(() => window.__flow.debug.debugKO(1));
              await page.evaluate(() => window.__net.haltAt(Infinity)); await R.evaluate(() => window.__net.haltAt(Infinity));
              await sleep(ko ? 4500 : 1500);
            }
            if (await at('onlinePost', 20000)) {
              await shot('onlinePost', 900);
              await R.evaluate(() => window.__flow.debug.go('onlineMenu'));   // the rival leaves the room
              await sleep(2500);
              await shot(`${await state()}-rivalleft`, 300);
            } else fail('onlinePost', [`never got there (${await state()})`]);
          } else fail('onlineFighting', [`never got there (${await state()}: ${await page.evaluate(() => document.querySelector('#flow')?.innerText.replace(/\s+/g, ' ').slice(0, 90))}; rival ${await R.evaluate(() => window.__flow.state)})`]);
        } else fail('onlineSelect', [`never got there (${await state()}: ${await page.evaluate(() => document.querySelector('#flow')?.innerText.replace(/\s+/g, ' ').slice(0, 80))})`]);
        await rctx.close();
      };
      await room();
      if (failed.length) { failed = []; await go('onlineMenu'); await sleep(30000); await room(); }
      for (const [st, lines] of failed) report(st, lines);
    }
    if (want('watchList') || want('watching')) {
      // two desktop pages fight in a public room; we watch
      const pages = [];
      const pctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
      for (const [id, nm] of [['c', 'CAROL'], ['d', 'DMITRI']]) {
        const P = await pctx.newPage();
        await P.addInitScript((x) => { localStorage.setItem('stick-fight-player', JSON.stringify({ id: x[0].repeat(32), name: x[1], email: '', crews: [] })); localStorage.setItem('stick-fight-track', '1'); }, [id, nm]);   // (a match is listed only when the host's events are on: off on localhost unless forced)
        await P.goto(URL_); await P.waitForFunction(() => window.__flow && window.__flow.state === 'attract');
        pages.push(P);
      }
      const [A, B] = pages;
      await A.evaluate(() => { const f = window.__flow.debug; f.go('modeSelect'); f.go('onlineMenu'); f.go('onlineHost'); });
      const code = await until(() => A.evaluate(() => (window.__net.state === 'waiting' && window.__net.code) || null));
      await B.evaluate(() => { const f = window.__flow.debug; f.go("modeSelect"); f.go("onlineMenu"); f.go("onlineJoin"); });
      await B.keyboard.type(String(code)); await B.evaluate(() => window.__flow.debug.go('onlineConnecting'));
      await until(() => A.evaluate(() => window.__flow.state === 'onlineSelect'), 20000);
      for (const P of pages) await P.evaluate(() => window.__net.pick && window.__net.pick(window.__flow.debug.sel.player, true));
      await until(() => A.evaluate(() => { window.__net.startNow && window.__net.startNow(); return window.__flow.state === 'onlineFighting'; }), 10000);
      await go('modeSelect', 'onlineMenu', 'watchList');
      await until(() => page.evaluate(() => !!document.querySelector('.fl-liverow')), 15000);
      await shot('watchList', 600);
      await page.evaluate(() => { const it = window.__flow.debug.ui.items.find((i) => i.el.classList.contains('fl-liverow')); it && it.act(); });
      if (await at('watching', 5000)) { await sleep(5000); await shot('watching', 300); } else report('watching', ['never got there']);
      await go('onlineMenu');
      await pctx.close();
    }
  }

  // ---- the local screens (--states local, or no --states) ----
  if (!STATES.length || STATES.includes('local')) await localTour();
  async function localTour() {
  await open(URL_, { 'stick-fight-player': player('SCOTT') });
  const panel = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:settings')));
  // The game is run ahead in the page instead of waited on ([t6z5am]): __game.advance steps the flow and the sim
  // without drawing, so a KO plays out, a round rolls over, the match pays, a card or the CONTINUE? clock runs out
  // through the game's own code in a few ms (headless draws a frame in about 60 ms, so 10 s of game took 16 s of wall
  // clock and the run took most of an hour). ff runs until the flow is on one of `want`, at most `secs` of game time.
  const ff = (want, secs = 15) => page.evaluate(([want, secs]) => {
    const f = window.__flow, g = window.__game;
    for (let i = 0; i < secs * 60 && !want.includes(f.state); i++) g.advance(1000 / 60);
    return f.state;
  }, [want, secs]);
  /** KO `winner`'s rival every round (the sim's own KO, debugKO) until the flow is on one of `want` */
  const playOut = (winner, want) => page.evaluate(([w, want]) => {
    const f = window.__flow, g = window.__game;
    for (let i = 0; i < 90 * 60 && !want.includes(f.state); i++) {
      if (f.state === 'fighting' && g.sim.phase === 'fight') f.debug.debugKO(w);
      g.advance(1000 / 60);
    }
    return f.state;
  }, [winner, want]);
  /** press the screen's button `k` (or the first that matches a pattern) once it takes presses: the flow's clock is
   *  moved past the arm time a result screen gives its buttons (0.5 to 1.2 s, so a held key from the fight can't) */
  const press = (k) => page.evaluate((k) => {
    const d = window.__flow.debug, ui = d.ui;
    const i = typeof k === 'number' ? k : ui.items.findIndex((it) => new RegExp(k).test(it.el.textContent));
    if (i < 0) return false;
    d.t = Math.max(d.t, 1.5); ui.items[i].act(); return true;
  }, k);
  const label0 = () => page.evaluate(() => { const ui = window.__flow.debug.ui; return ui.items[0] ? (ui.items[0].el.firstChild.textContent || '').trim() : ''; });
  // each step says when it isn't reached (round 3 of [t55b8f]: the tour stopped at CONTINUE? without a word)
  const step = async (s, ms = 3000) => { const ok = await at(s, ms); if (!ok) report(s, [`never got there (${await state()})`]); return ok; };
  /** pick the fighter on the select screen: it takes a pick once it has ticked, so the pick is tried until it lands */
  const pick = async () => {
    await until(() => page.evaluate(() => { const d = window.__flow.debug; if (window.__flow.state === 'charSelect') d.pickChar(d.sel.player); return window.__flow.state === 'stageIntro'; }), 5000, 200);
    return step('stageIntro');
  };
  const arcade = async () => {
    await go('attract', 'modeSelect');
    await page.evaluate(() => { const d = window.__flow.debug; d.sel.mode = 'arcade'; d.sel.step = 'player'; d.go('charSelect'); });
    return pick();
  };

  await shot('title');
  // SETTINGS, every tab (it's a page of its own: each tab is checked like a screen)
  const tab = (t) => page.evaluate((x) => document.querySelector(`.sf-tab[data-t="${x}"]`).click(), t);
  await panel(); await shot('title-settings', 700);
  for (const t of ['controls', 'audio', 'display']) { await tab(t); await shot(`settings-${t}`, 400); }
  await tab('game');
  // Q and E (the pad's LB and RB) switch the tab from anywhere on the page
  {
    const on = () => page.evaluate(() => document.querySelector('.sf-tab.sf-on').dataset.t);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('KeyE'); await sleep(100);
    const a = await on(); await page.keyboard.press('KeyE'); await page.keyboard.press('KeyQ'); await page.keyboard.press('KeyQ'); await page.keyboard.press('KeyQ'); await sleep(100);
    const b = await on();
    if (a !== 'controls' || b !== 'display') report('settings-tabkeys', [`Q/E TABS: E went to ${a} (want controls), E Q Q Q to ${b} (want display)`]);
    await tab('game');
  }
  await panel(); await sleep(300);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sf:homescreen')));
  if (await page.$('.sf-hs')) { await shot('title-howto', 600); await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.sf-hs').forEach((n) => n.remove())); }
  await go('modeSelect'); await shot('modeSelect');
  // MAIN MENU by the keys: down visits every row of the left column in order, one a press, and up comes back the same
  // way, through whichever half of SUPPLY CLOSET / HIGH SCORES you went down by (round 2 of [t55b8f])
  {
    const lit = () => page.evaluate(() => { const ui = window.__flow.debug.ui; return ui.focus < 0 ? '' : (ui.items[ui.focus].el.firstChild.textContent || '').trim(); });
    const walk = async (keys) => { const seen = []; for (const k of keys) { await page.keyboard.press(k); await sleep(60); seen.push(await lit()); } return seen.join(' > '); };
    await page.evaluate(() => window.__flow.debug.ui.setFocus(0)); await sleep(100);
    const want = [
      [['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'], 'VERSUS ONLINE > HORDE > TRAINING > SUPPLY CLOSET > SETTINGS'],
      [['ArrowUp', 'ArrowUp', 'ArrowUp'], 'SUPPLY CLOSET > TRAINING > HORDE'],
      [['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowUp'], 'TRAINING > SUPPLY CLOSET > HIGH SCORES > SETTINGS > HIGH SCORES > TRAINING'],
    ];
    for (const [keys, path] of want) { const got = await walk(keys); if (got !== path) report('modeSelect-keys', [`KEY WALK ${keys.join(' ')}: ${got} (want ${path})`]); }
    await page.evaluate(() => window.__flow.debug.ui.setFocus(0));
  }
  await press('HIGH SCORES'); if (await step('highScores')) await shot('highScores');
  await go('modeSelect');
  await page.evaluate(() => { const d = window.__flow.debug; d.sel.mode = 'arcade'; d.sel.step = 'player'; d.go('charSelect'); });
  await shot('charSelect', 900);
  await page.keyboard.press('F1'); await shot('charSelect-movelist', 700); await page.keyboard.press('Escape'); await sleep(300);
  if (await pick()) {
    await shot('stageIntro', 700);
    // SETTINGS over the stage card holds it: no fight starts under the page (round 2 of [t55b8f]). The card times out
    // at 3.4 s; 5 s of game time is run under the page
    await panel(); await sleep(200); await ff(['fighting'], 5);
    const st = await state(); if (st !== 'stageIntro') report('stageIntro-settings', [`THE FLOW MOVED ON UNDER SETTINGS: ${st}`]);
    await panel(); await sleep(200);
  }
  await go('fighting'); await ff(['_'], 1.5);
  await shot('fighting', 300);
  await page.keyboard.press('KeyP');
  if (await step('paused')) {
    await shot('paused');
    await panel(); await shot('paused-settings', 700); await panel(); await sleep(300);
    await page.keyboard.press('F1'); await shot('paused-movelist', 700); await page.keyboard.press('Escape'); await sleep(300);
    await page.keyboard.press('KeyP'); await at('fighting', 3000);
  }
  // win the stage: a KO each round, played out until the stage is clear
  await playOut(0, ['stageClear']);
  if (await step('stageClear')) await shot('stageClear');
  // lose the next one: CONTINUE?, then its clock runs out to GAME OVER, initials and the table
  await press(0);
  if (await step('stageIntro')) await go('fighting');
  await playOut(1, ['continue']);
  if (await step('continue')) {
    await shot('continue', 300);
    await ff(['gameOver'], 11);
    if (await step('gameOver')) {
      await shot('gameOver', 300);
      // GAME OVER's way on is named by where it goes: SIGN THE TABLE (a score makes the table) or HIGH SCORES
      const way = await label0();
      if (way !== 'SIGN THE TABLE') report('gameOver', [`WAY ON "${way}" (want SIGN THE TABLE: a first score makes the table)`]);
      await press(0);
      if (await step('enterInitials')) { await shot('enterInitials'); await press('^ENTER$'); }
      if (await step('highScores')) {
        await shot('highScores-new');
        if (await label0() !== 'TITLE') report('highScores-new', [`WAY ON "${await label0()}" (want TITLE)`]);
      }
    }
  }
  // the pause menu's run-ending choices ask first, NO lit, and Esc is NO
  if (await arcade()) {
    await go('fighting'); await sleep(200);
    await page.keyboard.press('Escape');
    if (await step('paused')) {
      const pick = (re) => page.evaluate((src) => { const ui = window.__flow.debug.ui; const k = ui.items.findIndex((i) => new RegExp(src).test(i.el.textContent)); ui.setFocus(k); ui.activate(); }, re);
      const asked = () => page.evaluate(() => ({ q: (document.querySelector('#flow .fl-ask .fl-h2') || {}).textContent || '', lit: window.__flow.debug.ui.items[window.__flow.debug.ui.focus]?.el.textContent || '' }));
      await pick('^MAIN MENU'); await sleep(200);
      const a = await asked();
      if (a.q !== 'QUIT TO MAIN MENU?' || a.lit !== 'NO') report('paused-quit', [`MAIN MENU ASKED "${a.q}" WITH "${a.lit}" LIT (want QUIT TO MAIN MENU? with NO)`]);
      else await shot('paused-quit');
      await page.keyboard.press('Escape'); await sleep(200);
      const b = await asked(); const st = await state();
      if (b.q || st !== 'paused' || !/^MAIN MENU/.test(b.lit)) report('paused-quit', [`ESC ON THE CONFIRM: ${st}, "${b.q}", cursor on "${b.lit}" (want PAUSED, on MAIN MENU)`]);
      await pick('^RESTART STAGE'); await sleep(200);
      const c = await asked();
      if (c.q !== 'RESTART STAGE?') report('paused-restart', [`RESTART STAGE ASKED "${c.q}"`]);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await sleep(200);
      if (await state() !== 'stageIntro') report('paused-restart', [`YES WENT TO ${await state()} (want stageIntro)`]);
    }
  }
  // the ending: the run jumps to the boss's stage (with a continue used, so no secret floor) and wins it
  if (await arcade()) {
    await page.evaluate(() => { const d = window.__flow.debug; d.run.stage = d.run.ladder.length - 1; d.run.continues = 1; });
    await go('fighting');
    await playOut(0, ['stageClear']);
    if (await step('stageClear')) {
      if (await label0() !== 'THE ENDING') report('stageClear-boss', [`WAY ON "${await label0()}" (want THE ENDING after the boss, with a continue used)`]);
      await press(0);
      if (await step('ending')) {
        await shot('ending', 1500);
        // the roll held at a third and two thirds of the way: the ladder's names, then the credits, judged in its box
        // (round 1 of [t55b8f] had the names at 11.3 px sideways)
        for (const k of [0.33, 0.66]) {
          const held = await page.evaluate((k) => {
            const a = document.querySelector('#flow .fl-roll > div')?.getAnimations()[0];
            if (!a) return false;
            a.pause(); a.currentTime = Number(a.effect.getComputedTiming().duration) * k; return true;
          }, k);
          if (held) await shot(`ending-roll${Math.round(k * 100)}`, 200); else report('ending', ['NO ROLL ANIMATION to hold']);
        }
        const way = await label0();
        if (!/^(SIGN THE TABLE|HIGH SCORES)$/.test(way)) report('ending', [`WAY ON "${way}"`]);
        // and on: the ending's table (its score signs it), then the table after a game
        await press(0);
        if (way === 'SIGN THE TABLE' && await step('enterInitials')) await press('^ENTER$');
        if (await step('highScores')) await shot('highScores-ending');
      }
    }
  }
  // the update pill on a menu: version.json says a newer build is out
  await page.route('**/version.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'newer', at: '' }) }));
  await go('attract', 'modeSelect');
  await page.evaluate(() => { if (window.__update) window.__update.check(); });
  if (await until(() => page.evaluate(() => !!document.querySelector('.up-pill:not([hidden])')), 4000)) await shot('modeSelect-update');
  }

  await ctx.close();
  console.log(`[${size.name}] done in ${Math.round((Date.now() - tz) / 1000)} s`);
}
{
  const queue = [...SIZES];
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => { while (queue.length) await tour(queue.shift()); }));
}
await browser.close();
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(dump, null, 1));
console.log(`${SIZES.length} sizes in ${Math.round((Date.now() - t0) / 1000)} s, ${JOBS} at a time`);
console.log(bad ? `${bad} problems` : 'nothing cut off or overlapping, text and tap targets at size, no page errors');
process.exit(CHECK && bad ? 1 : 0);
