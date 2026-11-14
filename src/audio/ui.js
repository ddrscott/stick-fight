// SETTINGS: every setting in the game on one full-screen page, under four tabs (README, Arcade flow, SETTINGS):
//   GAME      ROUNDS, ROUND TIME, BOTCHES and UPGRADES, the room rule for stat upgrades (src/flow/rules.js,
//             src/flow/techniques.js), from the next fight
//   CONTROLS  on a touch screen the size of the stick and buttons with a picture of them; then the fight and menu
//             tables, keyboard and gamepad (src/flow/controls.js), and the notes on dash, parry, getups and stairs
//   AUDIO     SOUND, MUSIC, the TRACK playing, MUSIC VOLUME and EFFECTS VOLUME
//   DISPLAY   GRAPHICS (src/gfxPrefs.js), and FULLSCREEN where the browser can do it (src/fullscreen.js)
// with the credits and the privacy and house rules links at the foot of DISPLAY. One page, opened four ways: the gear in
// the top-right corner on desktop (src/corner.js), the touch layer's gear (touch.js sends 'sf:settings'), and
// SETTINGS on MAIN MENU and in the pause menu (src/flow/index.js calls open()). Opened over a fight you can pause, the
// flow pauses it first ('sf:settings-open').
//
// It's a page, not a box over a menu: it covers the whole screen, opaque, above the touch controls, the corner
// buttons and the screen's own ‹ chip and legend, and it owns every press until it closes, so nothing under it can
// be reached. Its own ‹ chip in the top-left corner names where closing goes (‹ MAIN MENU, ‹ PAUSE MENU, ‹ TITLE:
// the flow says, through place()), like every screen's back, and its legend says the same (ESC MAIN MENU). The page
// is one size whatever the tab: the tab's rows scroll in the middle when they're taller than the screen, and then
// the middle's bottom edge fades (src/scrollcue.js) under a ▼ MORE chip that scrolls it on, so a cut-off row never
// reads as the end of the page.
//
// Every choice is the same row: its name and a line on what it does on the left, ‹ VALUE › on the right. A press on
// the row or › steps it on, ‹ steps it back, and left and right do the same from the keys and the pad. A volume's
// value is a bar you can also press or drag along. Neon arcade look: Bungee and Teko (index.html), hard corners.
//
// Keys and the pad (key(), fed by the flow's menu input): up and down move a cursor (the tabs are its first row; past
// the last row they scroll the page), left and right switch the tab or step a choice, confirm steps it on, back
// closes. Q and E (PageUp, PageDown) and the pad's LB and RB switch the tab from anywhere on the page. Escape always closes it and goes no further, so it never also resumes a paused game.
//
// touch.js cancels every touchmove on the page, so the volume bars are driven by pointer events, and the middle of
// the page is a data-scroll box (touch.js) a finger can scroll.

import { rootUrl } from '../root.js';   // the privacy and house rules pages, at the site's root
import { TOUCH_STEPS, TOUCH_DEFAULT, touchPref, touchStep, setTouchScale, touchFit, onTouchPref } from '../touchPrefs.js';
import { PLAIN } from '../plaintext.js';   // readable text never glows: the shared dark outline
import { MENU_ICON, cornerButton, cornerRow } from '../corner.js';
import { GFX_CHOICES, TIER_NAME, gfxPick, setGfxPick, onGfxPick, liveTier, onLiveTier } from '../gfxPrefs.js';   // GRAPHICS (README, Performance, Chromebooks)
import { bestOf, roundTime, stepBestOf, stepRoundTime, timeLabel, versusUpgrades, stepVersusUpgrades } from '../flow/rules.js';   // GAME: the match rules
import { botchEnabled, setBotchEnabled } from '../flow/techniques.js';                       // GAME: the botch switch
import { controlsTable, legend, FIGHT, MENUS } from '../flow/controls.js';                   // CONTROLS: the tables, and the legend
import { canFullscreen, isFullscreen, toggleFullscreen } from '../fullscreen.js';            // DISPLAY: FULLSCREEN, where it can work
import { paintCue } from '../scrollcue.js';                                                  // the fade at the middle's edge

const TABS = [['game', 'GAME'], ['controls', 'CONTROLS'], ['audio', 'AUDIO'], ['display', 'DISPLAY']];
const CHEV = (d) => `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${d < 0 ? 'M11.5 2.5 L5 9 L11.5 15.5' : 'M6.5 2.5 L13 9 L6.5 15.5'}"/></svg>`;
/** a choice's row: the name (and a line on what it does) on the left, ‹ VALUE › on the right */
const opt = (k, label, sub = '', cls = '') => `<div class="sf-opt ${cls}" data-o="${k}"><div class="sf-olabel"><label>${label}</label>${sub ? `<small>${sub}</small>` : ''}</div>`
  + `<div class="sf-val"><button class="sf-arr" data-d="-1" type="button" aria-label="${label.toLowerCase()}: less">${CHEV(-1)}</button><b></b>`
  + `<button class="sf-arr" data-d="1" type="button" aria-label="${label.toLowerCase()}: more">${CHEV(1)}</button></div></div>`;
/** the notes under the controls tables: what each technique is, in a line */
const NOTES = [
  ['DASH', 'TAP TOWARD HIM TWICE. ANY BUTTON DURING IT IS A DASH ATTACK. TAP AWAY TWICE TO HOP BACK (NO GUARD UNTIL IT ENDS).'],
  ['RISING ATTACK', 'OUT OF A CROUCH, LET GO OF DOWN AND PRESS A BUTTON.'],
  ['PARRY', 'TAP TOWARD HIM JUST BEFORE A HIT LANDS (DOWN-FORWARD FOR A LOW).'],
  ['KNOCKED DOWN', 'UP STANDS, AWAY ROLLS BACK, TOWARD HIM ROLLS UNDER HIM IF HE IS CLOSE, A BUTTON STRIKES FROM THE FLOOR.'],
  ['STOMP', 'OVER HIM ON THE FLOOR: DOWN + 4. A LOW THAT TOUCHES HIM HITS ONCE.'],
  ['AIR RECOVERY', 'JUGGLED: A BUTTON AT THE RIGHT MOMENT LANDS YOU ON YOUR FEET.'],
  ['STAIRS', 'WALK PAST THE FOOT TO GO UP. AT THE TOP, DOWN + TOWARD THE STEPS TO GO DOWN.'],
  ['MOVE LIST', 'EVERY FIGHTER\'S FULL LIST IS IN THE PAUSE MENU AND ON THE FIGHTER SELECT (F1, OR Y ON A PAD). IN A FIGHT F1 SHOWS A QUICK STRIP.'],
];

export function createSoundUI({ settings, music, actions, isUnlocked }) {
  if (typeof document === 'undefined') return { update() {}, close() {}, open() {}, key() { return false; }, isOpen: false, place: null };
  injectStyle();
  const isTouch = () => document.documentElement.classList.contains('touch-ui');

  // the desktop gear and its "press a key" hint, which sits beside the row it's in
  const btn = cornerButton('sf-menu', 'Settings', 2, MENU_ICON);
  const hint = el('div', 'sf-hint');
  cornerRow().appendChild(hint);
  btn.addEventListener('click', () => { actions.click(); toggle(); });

  const panel = el('div', 'sf-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' });
  panel.innerHTML = `
    <div class="sf-frame">
      <div class="sf-head">
        <button class="sf-close" type="button">${CHEV(-1)}<span class="sf-backto"></span></button>
        <h2>SETTINGS</h2>
      </div>
      <div class="sf-tabs" role="tablist">${TABS.map(([k, n]) => `<button class="sf-tab" data-t="${k}" type="button" role="tab">${n}</button>`).join('')}</div>
      <div class="sf-mid">
      <div class="sf-body" data-scroll="y">
        <div class="sf-page" data-p="game">
          ${opt('rounds', 'ROUNDS', 'ROUNDS TO WIN A MATCH')}
          ${opt('time', 'ROUND TIME', 'THE CLOCK ON EACH ROUND')}
          ${opt('botch', 'BOTCHES', 'A PRESS AT THE WRONG TIME STUMBLES')}
          ${opt('upgrades', 'UPGRADES', 'ROOMS YOU HOST: OFF, OR EVEN (BOTH FIGHTERS FULLY UPGRADED)')}
          <p class="sf-note">THESE START WITH THE NEXT FIGHT. ONLINE, THE HOST'S RULES ARE THE ONES PLAYED. HORDE HAS NO ROUNDS OR CLOCK. STAT UPGRADES YOU BOUGHT ONLY COUNT IN ARCADE, HORDE AND TRAINING; ONLINE THEY'RE OFF FOR BOTH UNLESS THE HOST PICKS EVEN, WHICH GIVES BOTH FIGHTERS EVERY UPGRADE.</p>
        </div>
        <div class="sf-page" data-p="controls">
          <div class="sf-touchonly">
            ${opt('size', 'CONTROL SIZE', 'THE STICK AND BUTTONS ON THIS SCREEN')}
            <div class="sf-tcprev" aria-hidden="true"><div class="sf-tcview"></div></div>
            <p class="sf-note">LEFT THUMB STEERS (FLICK IT TWICE THE SAME WAY TO DASH). THE BUTTONS STRIKE AND GUARD. MENUS ARE TAPPED.</p>
            <h3 class="sf-h3">KEYBOARD AND GAMEPAD</h3>
          </div>
          <div class="sf-tables"></div>
          <dl class="sf-notes">${NOTES.map(([h, p]) => `<dt>${h}</dt><dd>${p}</dd>`).join('')}</dl>
        </div>
        <div class="sf-page" data-p="audio">
          ${opt('sound', 'SOUND', 'EVERY SOUND IN THE GAME')}
          ${opt('music', 'MUSIC', 'THE SOUNDTRACK')}
          ${opt('track', 'TRACK', '', 'sf-trackrow')}
          ${opt('musicVolume', 'MUSIC VOLUME', '', 'sf-vol')}
          ${opt('sfxVolume', 'EFFECTS VOLUME', 'HITS, STEPS AND MENU CLICKS', 'sf-vol')}
          <p class="sf-note sf-keys">M TURNS THE MUSIC ON AND OFF, N SKIPS TO THE NEXT TRACK, IN ANY SCREEN.</p>
        </div>
        <div class="sf-page" data-p="display">
          ${opt('gfx', 'GRAPHICS', 'LOWER RUNS SMOOTHER ON A SLOW DEVICE')}
          ${canFullscreen ? opt('fullscreen', 'FULLSCREEN', 'THE GAME FILLS THE SCREEN (F11 TOO)') : ''}
          <p class="sf-note sf-gfx-note"></p>
          <h3 class="sf-h3">CREDITS</h3>
          <p class="sf-credit">MUSIC MADE WITH <a href="https://strudel.cc" target="_blank" rel="noopener">STRUDEL</a> (<a href="https://codeberg.org/uzu/strudel" target="_blank" rel="noopener">AGPL-3.0</a>) &nbsp;·&nbsp; GAME <a href="https://github.com/ddrscott/stick-fight" target="_blank" rel="noopener">SOURCE</a>
          <span class="sf-legal">&nbsp;·&nbsp; <a href="${rootUrl('privacy/').href}" target="_blank" rel="noopener">PRIVACY</a> &nbsp;·&nbsp; <a href="${rootUrl('terms/').href}" target="_blank" rel="noopener">HOUSE RULES</a></span></p>
        </div>
      </div>
      <button class="sf-more" type="button" tabindex="-1" aria-label="Scroll down for more">${CHEV(1)}<span>MORE</span></button>
      </div>
      <div class="sf-foot">
        <div class="sf-legend"></div>
      </div>
    </div>`;
  document.body.appendChild(panel);
  const $ = (s) => panel.querySelector(s);
  const body = $('.sf-body');
  // the page owns the screen: no press on it reaches the fight, the menu under it or main.js's tap-to-start
  for (const t of ['touchstart', 'pointerdown', 'mousedown', 'click', 'wheel']) panel.addEventListener(t, (e) => e.stopPropagation(), { passive: true });

  $('.sf-close').addEventListener('click', () => { actions.click('off'); close(); });
  // ▼ MORE: shows while there's more of the tab below the edge; a press scrolls most of a screen on
  const more = $('.sf-more');
  // the chip has a strip of its own under the rows (never over them), there whenever the tab is taller than the page,
  // so the rows don't jump when it hides at the bottom; it shows only while there's more below
  const mid = $('.sf-mid');
  const paintMore = () => {
    const strip = mid.classList.contains('sf-over') ? more.offsetHeight + 6 : 0;
    const over = body.scrollHeight > body.clientHeight + strip + 2;
    if (over !== mid.classList.contains('sf-over')) mid.classList.toggle('sf-over', over);
    paintCue(body); more.classList.toggle('sf-show', body.classList.contains('sc-more'));
  };
  body.addEventListener('scroll', paintMore, { passive: true });
  // a finger that lands on the chip and drags scrolls the page like anywhere else on it (touch.js cancels the
  // browser's own scroll outside a data-scroll box, so the chip moves the middle itself); a tap still scrolls on
  let drag = null;
  more.addEventListener('touchstart', (e) => { drag = { y: e.touches[0].clientY, top: body.scrollTop, moved: false }; }, { passive: true });
  more.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.touches[0].clientY;
    if (Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved) body.scrollTop = drag.top + dy;
  }, { passive: true });
  more.addEventListener('click', () => {
    const dragged = drag && drag.moved; drag = null;
    if (dragged) return;
    actions.click(); body.scrollBy({ top: body.clientHeight * 0.7, behavior: 'smooth' });
  });
  $('.sf-tables').append(controlsTable(FIGHT, 'FIGHT'), controlsTable(MENUS, 'MENUS'));

  // CONTROLS: the touch layer's size, and a picture of it: a copy of the live layer in a box the screen's shape,
  // scaled down, so a step is seen at once without the real controls covering the page
  const prevBox = $('.sf-tcprev'), prevView = $('.sf-tcview');
  function paintPreview() {
    if (!open || tab !== 'controls' || !isTouch()) { prevView.textContent = ''; return; }
    const live = document.querySelector('body > .tc-root');
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    prevBox.style.aspectRatio = `${vw} / ${vh}`;
    // as wide as the page allows, but never more than about a third of the screen's height
    prevBox.style.width = `${Math.min(420, body.clientWidth - 16, Math.max(120, vh * 0.36) * vw / vh)}px`;
    const w = prevBox.clientWidth || 1;
    prevView.style.width = `${vw}px`; prevView.style.height = `${vh}px`; prevView.style.transform = `scale(${w / vw})`;
    prevView.textContent = '';
    if (live) { const c = /** @type {HTMLElement} */ (live.cloneNode(true)); c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id')); prevView.appendChild(c); }
  }
  const pickStep = (i) => {
    const n = Math.max(0, Math.min(TOUCH_STEPS.length - 1, i));
    actions.click(n === touchStep() ? 'off' : 'on');
    if (n !== touchStep()) setTouchScale(TOUCH_STEPS[n].scale);
  };
  onTouchPref(() => { paintOpts(); requestAnimationFrame(paintPreview); });
  window.addEventListener('resize', () => { if (open) requestAnimationFrame(() => { paintPreview(); paintMore(); }); });

  // GRAPHICS: AUTO (the adaptive tier, the default) or a fixed tier, which turns adaptation off. Under it, what AUTO
  // is drawing at right now (src/gfxPrefs.js; src/main.js applies the choice).
  const pickGfx = (id) => { actions.click(id === gfxPick() ? 'off' : 'on'); setGfxPick(id); };
  const gfxNote = () => {
    const pick = gfxPick(), live = liveTier();
    $('.sf-gfx-note').textContent = pick === 'auto' ? (live >= 0 ? `AUTO PICKS FOR THIS DEVICE. DRAWING AT ${TIER_NAME[live]} NOW.` : 'AUTO PICKS FOR THIS DEVICE.') : 'FIXED: IT STAYS HERE EVEN IF THE GAME SLOWS DOWN.';
  };
  onGfxPick(() => paintOpts()); onLiveTier(() => paintOpts());
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => paintOpts());

  // ---- the rows: how each steps and what it shows ----------------------------------------------------------
  const vol = (k, v) => { v = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100; if (k === 'musicVolume') actions.setMusicVolume(v); else actions.setSfxVolume(v); return v; };
  const volHtml = (v) => `<span class="sf-bar"><i style="width:${Math.round(v * 100)}%"></i></span><span class="sf-num">${Math.round(v * 100)}</span>`;
  const musicOn = () => settings.sound && settings.music;
  const OPTS = {
    rounds: { step: (d) => stepBestOf(d), text: () => `BEST OF ${bestOf()}` },
    time: { step: (d) => stepRoundTime(d), text: () => (roundTime() ? `${roundTime()} SECONDS` : timeLabel(0)) },
    botch: { step: () => setBotchEnabled(!botchEnabled()), text: () => (botchEnabled() ? 'ON' : 'OFF') },
    upgrades: { step: () => stepVersusUpgrades(), text: () => (versusUpgrades() === 'even' ? 'EVEN' : 'OFF') },
    gfx: { quiet: true, step: (d) => { const at = GFX_CHOICES.findIndex((c) => c.id === gfxPick()), to = GFX_CHOICES[(at + d + GFX_CHOICES.length) % GFX_CHOICES.length]; pickGfx(to.id); }, text: () => (GFX_CHOICES.find((x) => x.id === gfxPick()) || GFX_CHOICES[0]).name },
    size: { quiet: true, step: (d) => pickStep(touchStep() + d), text: () => TOUCH_STEPS[touchStep()].name, ends: () => [touchStep() === 0, touchStep() === TOUCH_STEPS.length - 1] },
    fullscreen: { step: () => toggleFullscreen(), text: () => (isFullscreen() ? 'ON' : 'OFF') },
    sound: { quiet: true, step: () => { const on = !settings.sound; actions.click(on ? 'on' : 'off'); actions.setSound(on); }, text: () => (settings.sound ? 'ON' : 'OFF') },
    music: { quiet: true, step: () => { const on = !musicOn(); actions.click(on ? 'on' : 'off'); actions.setMusic(on); }, text: () => (musicOn() ? 'ON' : 'OFF') },
    track: { step: (d) => (d < 0 ? actions.prev() : actions.next()), text: () => { const t = music.tracks[music.state.track]; return t ? t.name.toUpperCase() : '-'; } },
    musicVolume: { step: (d) => vol('musicVolume', settings.musicVolume + d * 0.1), html: () => volHtml(settings.musicVolume), ends: () => [settings.musicVolume <= 0, settings.musicVolume >= 1] },
    sfxVolume: { step: (d) => { vol('sfxVolume', settings.sfxVolume + d * 0.1); actions.sfxPreview(); }, html: () => volHtml(settings.sfxVolume), ends: () => [settings.sfxVolume <= 0, settings.sfxVolume >= 1] },
  };
  function stepOpt(k, d) {
    const o = OPTS[k]; if (!o) return;
    if (!o.quiet) actions.click(d > 0 ? 'on' : 'off');
    o.step(d); paintOpts();
  }
  function paintOpts() {
    for (const [k, o] of Object.entries(OPTS)) {
      const row = $(`.sf-opt[data-o="${k}"]`); if (!row) continue;
      const b = row.querySelector('.sf-val b');
      if (o.html) b.innerHTML = o.html(); else b.textContent = o.text();
      const [lo, hi] = o.ends ? o.ends() : [false, false];
      row.querySelector('.sf-arr[data-d="-1"]').classList.toggle('sf-end', lo);
      row.querySelector('.sf-arr[data-d="1"]').classList.toggle('sf-end', hi);
    }
    // the lines that change under a row: the size the screen allows, the track's state, AUTO's tier
    const size = $('.sf-opt[data-o="size"] small');
    size.textContent = touchFit.clamped ? `THIS SCREEN FITS ${Math.round(touchFit.scale * 100)}%` : touchPref().scale === TOUCH_DEFAULT ? 'THE STICK AND BUTTONS ON THIS SCREEN (NORMAL IS THE DEFAULT)' : 'THE STICK AND BUTTONS ON THIS SCREEN';
    const t = music.tracks[music.state.track];
    $('.sf-opt[data-o="track"] .sf-olabel').querySelector('small')?.remove();
    const mood = music.state.loading ? 'LOADING…' : music.state.error ? 'MUSIC ERROR' : musicOn() && !isUnlocked() ? (isTouch() ? 'PICK THE SONG. IT PLAYS AFTER YOUR FIRST TAP' : 'PICK THE SONG. IT PLAYS AFTER YOUR FIRST KEY') : !musicOn() ? 'MUSIC IS OFF' : t ? `${t.bpm} BPM, NOW PLAYING` : '';
    const ml = el('small', ''); ml.textContent = mood;
    $('.sf-opt[data-o="track"] .sf-olabel').appendChild(ml);
    $('.sf-opt[data-o="musicVolume"]').classList.toggle('sf-dim', !musicOn());
    $('.sf-opt[data-o="track"]').classList.toggle('sf-dim', !musicOn());
    $('.sf-opt[data-o="sfxVolume"]').classList.toggle('sf-dim', !settings.sound);
    gfxNote();
    if (open) paintMore();
  }
  panel.querySelectorAll('.sf-opt').forEach((row) => {
    const k = /** @type {HTMLElement} */ (row).dataset.o;
    row.addEventListener('click', (e) => {
      const t = /** @type {Element} */ (e.target);
      if (t.closest('.sf-bar')) return;   // the volume bar sets the level where it's pressed (below)
      const arr = t.closest('.sf-arr');
      stepOpt(k, arr ? Number(/** @type {HTMLElement} */ (arr).dataset.d) : 1);
      setCursor(navItems().find((it) => it.el === row) || null, false);
    });
  });
  // a volume's bar: press or drag along it
  for (const k of ['musicVolume', 'sfxVolume']) {
    const row = $(`.sf-opt[data-o="${k}"]`);
    let dragging = false;
    const setFrom = (e) => { const bar = row.querySelector('.sf-bar'); if (!bar) return; const r = bar.getBoundingClientRect(); vol(k, (e.clientX - r.left) / r.width); paintOpts(); };
    row.addEventListener('pointerdown', (e) => {
      if (!(/** @type {Element} */ (e.target)).closest('.sf-bar')) return;
      dragging = true; try { row.setPointerCapture(e.pointerId); } catch (_) { /* old browser */ } setFrom(e); e.preventDefault();
    });
    row.addEventListener('pointermove', (e) => { if (dragging) setFrom(e); });
    const end = () => { if (!dragging) return; dragging = false; if (k === 'sfxVolume') actions.sfxPreview(); };   // letting go plays one, so you hear the level
    row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
  }

  // the tabs: one page at a time, the last one picked is where it opens next time (this visit)
  let tab = 'game';
  function showTab(t, sound = false) {
    if (!TABS.some(([k]) => k === t)) return;
    if (sound && t !== tab) actions.click();
    tab = t;
    panel.querySelectorAll('.sf-tab').forEach((b) => { const on = /** @type {HTMLElement} */ (b).dataset.t === t; b.classList.toggle('sf-on', on); b.setAttribute('aria-selected', String(on)); });
    panel.querySelectorAll('.sf-page').forEach((p) => p.classList.toggle('sf-show', /** @type {HTMLElement} */ (p).dataset.p === t));
    body.scrollTop = 0;
    paintPreview();
    requestAnimationFrame(paintMore);
  }
  panel.querySelectorAll('.sf-tab').forEach((b) => b.addEventListener('click', () => { showTab(/** @type {HTMLElement} */ (b).dataset.t, true); if (cursor) setCursor(navItems()[0]); }));

  // the touch layer's gear, and a click for its small buttons
  window.addEventListener('sf:settings', () => toggle());
  document.addEventListener('touchstart', (e) => {
    const t = e.target instanceof Element && e.target.closest('.tc-top .tc-btn');
    if (t) actions.click();
  }, { passive: true, capture: true });

  let open = false, raf = 0;
  const api = { update, close, open: show, key, get isOpen() { return open; }, /** where closing goes, by name (the flow sets it) */ place: null };
  function toggle() { if (open) close(); else show(); }
  /** keys: opened from a key or the pad, so the cursor shows at once (a click or a tap shows none until a key is used);
   *  tab: open on this tab */
  function show({ keys = false, tab: t = '' } = {}) {
    if (open) return;
    window.dispatchEvent(new CustomEvent('sf:settings-open'));   // over a fight you can pause, the flow pauses it first
    open = true;
    const to = (api.place && api.place()) || 'GAME';
    $('.sf-backto').textContent = to;
    $('.sf-close').setAttribute('aria-label', `Close settings, back to ${to.toLowerCase()}`);
    const lg = $('.sf-legend'); lg.textContent = '';
    lg.appendChild(legend([['move', 'PICK / CHANGE'], ['tab', 'TAB'], ['back', to]]));
    document.documentElement.classList.add('sf-up');
    panel.classList.add('sf-open');
    showTab(t || tab); update(); paintOpts(); meterLoop();
    setCursor(keys ? navItems()[0] : null);
  }
  function close() {
    if (!open) return;
    open = false; panel.classList.remove('sf-open'); document.documentElement.classList.remove('sf-up');
    cancelAnimationFrame(raf); setCursor(null); prevView.textContent = '';
    window.dispatchEvent(new CustomEvent('sf:settings-closed'));   // the flow hands the keys back to the screen under it
  }
  // Escape closes the page and nothing else: caught before the menus, the pause key and the online LEAVE confirm
  window.addEventListener('keydown', (e) => {
    if (!open || e.code !== 'Escape') return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!e.repeat) { actions.click('off'); close(); }
  }, { capture: true });

  // ---- keys and the pad ----------------------------------------------------------------------
  // The cursor's stops, top to bottom: the tab row, then this tab's rows that show (CONTROL SIZE only on touch)
  let cursor = null;
  const navItems = () => [
    { el: $(`.sf-tab[data-t="${tab}"]`), tab: true },
    ...[...panel.querySelectorAll(`.sf-page[data-p="${tab}"] .sf-opt`)].map((r) => ({ el: r, opt: /** @type {HTMLElement} */ (r).dataset.o })),
  ].filter((it) => it.el && it.el.offsetParent !== null);
  function setCursor(it, scroll = true) {
    if (cursor) cursor.classList.remove('sf-focus');
    cursor = it ? it.el : null;
    if (!cursor) return;
    cursor.classList.add('sf-focus');
    if (scroll && it.tab) body.scrollTop = 0;
    else if (scroll && cursor.scrollIntoView) cursor.scrollIntoView({ block: 'nearest' });
  }
  /** a menu key (src/flow/menuInput.js) while the page is open; true when it took it (it takes every one) */
  function key(k) {
    if (!open) return false;
    if (k === 'back' || k === 'escape' || k === 'select' || k === 'start' || k === 'pause') { actions.click('off'); close(); return true; }
    if (k === 'prevtab' || k === 'nexttab') {   // Q E, LB RB: the next tab from anywhere, the cursor on its first row
      const at = TABS.findIndex(([t]) => t === tab), to = TABS[(at + (k === 'nexttab' ? 1 : -1) + TABS.length) % TABS.length][0];
      showTab(to, true); const n = navItems(); setCursor(n[1] || n[0]); return true;
    }
    const its = navItems(), i = its.findIndex((it) => it.el === cursor);
    if (i < 0) { if (its.length && k !== 'moves' && k !== 'del') setCursor(its[0]); return true; }   // the first key only shows the cursor
    const it = its[i], d = k === 'down' || k === 'right' ? 1 : -1;
    if (it.tab && (k === 'left' || k === 'right')) {   // the tab row: left and right switch the page
      const at = TABS.findIndex(([t]) => t === tab), to = TABS[(at + d + TABS.length) % TABS.length][0];
      showTab(to, true); setCursor(navItems()[0]); return true;
    }
    if (k === 'up' || k === 'down') {
      const room = body.scrollHeight - body.clientHeight;
      // past the last row (or on a tab with none, like CONTROLS on a desktop) down scrolls what's under it, and up
      // scrolls back before leaving for the row above
      if (d > 0 && !its[i + 1] && body.scrollTop < room - 1) { body.scrollBy({ top: body.clientHeight * 0.6 }); return true; }
      if (d < 0 && it.tab && body.scrollTop > 1) { body.scrollBy({ top: -body.clientHeight * 0.6 }); return true; }
      if (its[i + d]) { actions.click(); setCursor(its[i + d]); }
    } else if ((k === 'left' || k === 'right') && it.opt) stepOpt(it.opt, d);
    else if (k === 'confirm' && it.opt) stepOpt(it.opt, 1);
    return true;
  }
  // the track's line says LOADING and the like as it changes: repaint it while the page is up
  let last = '';
  function meterLoop() {
    if (!open) return;
    const now = `${music.state.track}|${music.state.loading}|${music.state.error}|${music.state.playing}|${isUnlocked()}`;
    if (now !== last) { last = now; paintOpts(); }
    raf = requestAnimationFrame(meterLoop);
  }

  function update() {
    const unlocked = isUnlocked(), soundOn = settings.sound;
    if (open) paintOpts();
    // the gears show sound off, and pulse while sound is wanted but still locked
    const locked = soundOn && !unlocked;
    const touchBtn = document.querySelector('[data-role="settings"]');
    for (const b of [btn, touchBtn]) if (b) { b.classList.toggle('sf-muted', !soundOn); b.classList.toggle('sf-locked', locked); }
    hint.textContent = locked && !isTouch() ? 'PRESS ANY KEY FOR SOUND' : '';
    hint.classList.toggle('sf-show', locked && !isTouch());
  }
  showTab('game');
  paintOpts();
  update();
  // touch.js builds its layer after this module runs; pick its button up once it's there
  setTimeout(update, 0); setTimeout(update, 600);
  return api;
}

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag); n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function injectStyle() {
  if (document.getElementById('sf-sound-style')) return;
  // sizes: px floors for a phone, growing with the screen's short side up to a desktop's (a 1280x720 window reads
  // 24 px rows; a phone sideways 20 px). Nothing a player reads is under 14 px anywhere.
  const css = `
  .sf-panel, .sf-hint { --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff; --ink: #fff4fd; }
  .sf-locked { animation: sf-pulse 1.1s ease-in-out infinite; }
  @keyframes sf-pulse { 50% { box-shadow: 0 0 18px var(--amber, #ffb02e), 0 0 4px var(--amber, #ffb02e); } }
  /* in the corner row (src/corner.js), to the left of its buttons */
  html.touch-ui .sf-hint { display: none; }
  .sf-hint {
    order: 0; margin-right: 0.25rem; white-space: nowrap; pointer-events: none; opacity: 0;
    font: 500 17px/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.08em; color: var(--amber);
    text-shadow: ${PLAIN}; transition: opacity 200ms;   /* a hint to read: no glow */
  }
  .sf-hint.sf-show { opacity: 0.9; }

  /* the page: the whole screen, opaque, over everything the game draws (the touch controls are 20, the update pill 30,
     the home-screen how-to 50; the move list, 60, never opens while this is up) */
  .sf-panel {
    --row: clamp(19px, calc(1.9vmin + 10px), 30px); --sub: clamp(15px, calc(0.9vmin + 10px), 20px); --pad: clamp(10px, 2.4vmin, 28px);
    position: fixed; inset: 0; z-index: 55; display: none; box-sizing: border-box;
    padding: max(var(--pad), env(safe-area-inset-top)) max(var(--pad), env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(var(--pad), env(safe-area-inset-left));
    background: radial-gradient(ellipse at 50% 0%, #1c0838 0%, #0b0318 55%, #07020f 100%); color: var(--ink);
    font-family: 'Teko', 'Arial Narrow', sans-serif; text-shadow: ${PLAIN};   /* settings are read, so the letters don't glow (README, "The look") */
    touch-action: none; overscroll-behavior: contain; -webkit-user-select: none; user-select: none;
  }
  .sf-panel.sf-open { display: block; animation: sf-in 140ms ease-out; }
  @keyframes sf-in { from { opacity: 0; } to { opacity: 1; } }
  .sf-panel * { box-sizing: border-box; }
  .sf-panel button { font-family: 'Bungee', 'Arial Black', sans-serif; cursor: pointer; }
  /* one size whatever the tab: the head, the tabs and the foot stay put, the middle scrolls */
  .sf-frame { width: min(1040px, 100%); height: 100%; margin: 0 auto; display: flex; flex-direction: column; }
  /* the head: the ‹ chip names where closing goes, in the corner like every screen's (README, Arcade flow, "Back and the corner") */
  .sf-head { flex: none; display: flex; align-items: center; gap: clamp(12px, 2vw, 28px); margin-bottom: clamp(8px, 1.6vmin, 16px); }
  .sf-close { flex: none; height: clamp(40px, 6.4vmin, 50px); padding: 0 0.9em 0 0.55em; display: flex; align-items: center; gap: 0.45em;
    background: rgba(10,4,20,0.82); color: color-mix(in srgb, var(--violet) 45%, #fff); border: 2px solid var(--violet); border-radius: 0;
    font: 600 clamp(16px, calc(1.2vmin + 9px), 22px)/1 'Teko', 'Arial Narrow', sans-serif !important; letter-spacing: 0.1em; text-shadow: ${PLAIN}; }
  .sf-close span { padding-top: 0.14em; white-space: nowrap; }
  .sf-close svg, .sf-arr svg { width: 0.85em; height: 0.85em; flex: none; fill: none; stroke: currentColor; stroke-width: 3.2; stroke-linecap: square; }
  .sf-arr svg { width: 45%; height: 45%; }
  .sf-close:hover, .sf-close:active { background: var(--violet); color: #12041f; text-shadow: none; }
  .sf-head h2 { margin: 0; min-width: 0; font: 400 clamp(22px, calc(2.6vmin + 10px), 40px)/1 'Bungee', 'Arial Black', sans-serif; letter-spacing: 0.06em; color: #ff8fe8; white-space: nowrap; }
  /* the tabs: the picked one filled */
  .sf-tabs { flex: none; display: flex; gap: clamp(4px, 0.8vmin, 10px); margin-bottom: clamp(6px, 1.2vmin, 14px); }
  .sf-tab { flex: 1 1 0; min-width: 0; height: clamp(42px, 6.6vmin, 54px); padding: 0 4px; background: rgba(46,242,255,0.04); color: rgba(255,244,253,0.78);
    border: 2px solid rgba(46,242,255,0.45); border-radius: 0; font-size: clamp(13px, calc(0.8vmin + 9px), 18px); letter-spacing: 0.05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sf-tab:hover { border-color: var(--cyan); color: var(--ink); }
  .sf-tab.sf-on { color: #0a0414; background: var(--cyan); border-color: var(--cyan); text-shadow: none; }
  /* the middle: this tab's rows, scrolling under a finger, the wheel or the keys when they're taller than the screen */
  .sf-mid { position: relative; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
  .sf-body { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; touch-action: pan-y; overscroll-behavior: contain;
    border-top: 2px solid rgba(166,107,255,0.35); border-bottom: 2px solid rgba(166,107,255,0.35); padding: 0 2px; scrollbar-color: rgba(166,107,255,0.6) transparent; }
  .sf-page { display: none; padding-bottom: 10px; }
  .sf-page.sf-show { display: block; }
  /* a choice: its name and what it does on the left, ‹ VALUE › on the right, the whole row a button */
  .sf-opt { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: clamp(56px, 9vmin, 76px); padding: 6px 8px; cursor: pointer;
    border-bottom: 2px solid rgba(166,107,255,0.2); }
  .sf-opt:hover { background: rgba(46,242,255,0.05); }
  .sf-olabel { display: flex; flex-direction: column; min-width: 0; line-height: 1.05; }
  .sf-olabel label { font-size: var(--row); font-weight: 600; letter-spacing: 0.06em; color: var(--cyan); cursor: pointer; }
  .sf-olabel small { margin-top: 2px; font-size: var(--sub); font-weight: 500; letter-spacing: 0.04em; color: rgba(255,244,253,0.72); }
  .sf-val { display: flex; align-items: center; gap: 6px; flex: none; }
  .sf-val b { width: calc(var(--row) * 7.4); max-width: 46vw; display: flex; align-items: center; justify-content: center; gap: 10px; text-align: center;
    font: 600 var(--row)/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.06em; color: var(--amber); padding-top: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sf-trackrow .sf-val b { display: block; }
  .sf-arr { width: clamp(42px, 6.6vmin, 52px); height: clamp(42px, 6.6vmin, 52px); padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--amber);
    border: 2px solid rgba(255,176,46,0.6); border-radius: 0; }
  .sf-arr:hover, .sf-arr:active { background: var(--amber); color: #12041f; }
  .sf-arr.sf-end { opacity: 0.3; }
  .sf-opt.sf-dim .sf-olabel label, .sf-opt.sf-dim .sf-val b { opacity: 0.5; }
  /* a volume: a bar and the number */
  .sf-bar { position: relative; flex: 1; height: 26px; cursor: pointer; touch-action: none; }
  .sf-bar::before { content: ''; position: absolute; left: 0; right: 0; top: 10px; height: 6px; background: rgba(166,107,255,0.3); }
  .sf-bar i { position: absolute; left: 0; top: 10px; height: 6px; background: var(--cyan); }
  .sf-bar i::after { content: ''; position: absolute; right: -6px; top: -7px; width: 12px; height: 20px; background: var(--ink); border: 2px solid var(--cyan); }
  .sf-num { flex: none; width: 2.2em; text-align: right; }
  /* the cursor of a keyboard or a pad: a full outline, never a one-edge rail */
  .sf-panel .sf-focus { outline: 2px solid var(--ink); outline-offset: -2px; }
  .sf-panel .sf-opt.sf-focus { background: rgba(46,242,255,0.09); }
  .sf-panel button:focus { outline: none; } .sf-panel button.sf-focus:focus { outline: 2px solid var(--ink); }
  .sf-note { margin: 10px 8px 2px; font-size: var(--sub); line-height: 1.15; letter-spacing: 0.05em; color: rgba(255,244,253,0.72); }
  html.touch-ui .sf-keys { display: none; }
  /* CONTROLS: the touch size and its picture only on a touch screen; then the tables, which wrap rather than run past
     the page, and the notes */
  .sf-touchonly { display: none; }
  html.touch-ui .sf-touchonly { display: block; }
  .sf-tcprev { position: relative; margin: 10px auto 0; overflow: hidden; border: 2px solid rgba(46,242,255,0.45);
    background: linear-gradient(#150630, #0a0318); }
  .sf-tcview { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
  /* the copy shows the stick and buttons even on a menu, where the live ones are hidden (play/index.html) */
  html .sf-panel .sf-tcview .tc-root { display: block !important; pointer-events: none !important; }
  .sf-tcview .tc-root * { pointer-events: none !important; }
  html .sf-panel .sf-tcview .tc-root .tc-stickzone { display: block !important; }
  html .sf-panel .sf-tcview .tc-root .tc-cluster { display: flex !important; }
  .sf-h3 { margin: 14px 8px 0; font: 400 clamp(15px, calc(0.8vmin + 11px), 20px)/1 'Bungee', 'Arial Black', sans-serif; letter-spacing: 0.05em; color: #c8ff3a; }
  .sf-tables { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 14px clamp(18px, 4vw, 48px); padding: 12px 8px 4px; }
  .sf-tables .lg-table { --lg-size: var(--sub); flex: 1 1 300px; min-width: 0; grid-template-columns: auto auto auto; justify-content: start;
    column-gap: 10px; row-gap: 6px; white-space: normal; }
  .sf-tables .lg-th:first-child { font-size: clamp(15px, calc(0.8vmin + 11px), 20px); padding-bottom: 2px; }
  .sf-tables .lg-th.lg-col { font-size: 14px; align-self: end; }
  .sf-tables .lg-pill { font-size: 13px; }
  .sf-tables .lg-what, .sf-tables .lg-padtext { overflow-wrap: break-word; }
  .sf-tables .lg-key { white-space: normal; max-width: 100%; overflow-wrap: break-word; }
  .sf-notes { margin: 8px 8px 0; display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; font-size: var(--sub); line-height: 1.15; letter-spacing: 0.05em; }
  .sf-notes dt { color: var(--cyan); font-weight: 600; white-space: nowrap; }
  .sf-notes dd { margin: 0; color: rgba(255,244,253,0.8); }
  /* ▼ MORE: in its own strip under the faded bottom edge while there's more below, centered, a press scrolls on */
  .sf-more { flex: none; align-self: center; margin-top: 6px; display: none; visibility: hidden; align-items: center; gap: 0.4em; height: 40px; padding: 0 1em 0 0.8em;
    background: #0b0318; color: var(--cyan); border: 2px solid var(--cyan); border-radius: 0; font: 600 18px/1 'Teko', 'Arial Narrow', sans-serif !important; letter-spacing: 0.12em; text-shadow: ${PLAIN}; }
  .sf-mid.sf-over .sf-more { display: flex; } .sf-more.sf-show { visibility: visible; }
  .sf-more svg { width: 0.9em; height: 0.9em; transform: rotate(90deg); fill: none; stroke: currentColor; stroke-width: 3.2; stroke-linecap: square; }
  .sf-more span { padding-top: 0.14em; }
  .sf-more:hover, .sf-more:active { background: var(--cyan); color: #0a0414; text-shadow: none; }
  /* the foot: the keys, centered (none on a touch screen, where everything is tapped, so no foot at all there) */
  .sf-foot { flex: none; display: flex; align-items: center; justify-content: center; gap: 16px; min-height: 34px; padding-top: 6px; }
  html.dev-touch .sf-foot { display: none; }
  .sf-credit { margin: 8px 8px 0; font-size: var(--sub); line-height: 1.5; letter-spacing: 0.08em; color: rgba(255,244,253,0.65); }
  .sf-credit a { color: #4df3ff; text-decoration: none; border-bottom: 1px solid rgba(77,243,255,0.4); }
  .sf-legend .lg-bar { --lg-size: max(16px, calc(0.9vmin + 10px)); position: static; transform: none; gap: 1.6em; }
  /* a narrow screen (a phone held upright): the value goes under the name, and the notes stack */
  @media (max-width: 560px) {
    .sf-opt { flex-wrap: wrap; row-gap: 4px; }
    .sf-olabel { flex: 1 1 100%; }
    .sf-val { flex: 1 1 100%; }
    .sf-val b { flex: 1; width: auto; max-width: none; }
    .sf-notes { grid-template-columns: 1fr; gap: 2px; } .sf-notes dd { margin-bottom: 8px; }
    .sf-foot { display: none; }
    .sf-tab { font-size: 12px; letter-spacing: 0; padding: 0 2px; }
  }
  /* a short screen (a phone held sideways): the label and its line share less height */
  @media (max-height: 460px) {
    .sf-opt { min-height: 50px; padding: 3px 8px; }
    .sf-head { margin-bottom: 6px; }
  }`;
  const s = document.createElement('style');
  s.id = 'sf-sound-style';
  s.textContent = css;
  document.head.appendChild(s);
}
