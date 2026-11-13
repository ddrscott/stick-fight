// The SETTINGS panel: every setting in the game, in one place, under three tabs (README, Arcade flow, SETTINGS):
//   GAME     ROUNDS, ROUND TIME and BOTCHES (src/flow/rules.js, src/flow/techniques.js), from the next fight
//   AUDIO    SOUND and MUSIC switches, the track playing with NEXT, a meter, MUSIC and EFFECTS sliders
//   DISPLAY  GRAPHICS (src/gfxPrefs.js) and, on a touch screen, the size of the controls
// with the credits and the privacy and house rules links under them. One panel, opened four ways: the menu button
// (three bars) in the top-right corner on desktop (src/corner.js), the touch layer's menu button (touch.js sends
// 'sf:settings'), and SETTINGS on MAIN MENU and in the pause menu (src/flow/index.js calls open()). Its ‹ in the
// top left closes it, like every screen's back. Neon arcade look: Bungee and Teko (loaded by index.html), the touch
// layer's palette, hard corners. A choice is a row: its name on the left, ‹ VALUE › on the right; a press on the
// row or › steps it on, ‹ steps it back, and left and right do the same from the keys and the pad.
//
// On a touch screen the panel also holds CONTROLS: the size of the touch layer's stick and buttons
// (src/touchPrefs.js), five steps with RESET. While the panel is open <html> has .tc-preview, which
// shows the controls behind it on every screen, so each press is seen at once. A desktop never
// shows the row.
//
// Keys and the pad work it too (key(), fed by the flow's menu input): up and down move a cursor (the tabs are
// its first row), left and right switch the tab, turn a slider, or step a choice or the size, confirm presses,
// back closes. Escape always closes it and goes no further, so it never also resumes a paused game.
//
// The sliders are drawn here and driven by pointer events, because touch.js cancels every
// touchmove on the page and a native range input on Android needs those. The panel itself is a
// data-scroll box (touch.js), so where it's taller than the screen a finger scrolls it.

import { rootUrl } from '../root.js';   // the privacy and house rules pages, at the site's root
import { TOUCH_STEPS, TOUCH_DEFAULT, touchPref, touchStep, setTouchScale, touchFit, onTouchPref } from '../touchPrefs.js';
import { PLAIN } from '../plaintext.js';   // readable text never glows: the shared dark outline
import { MENU_ICON, cornerButton, cornerRow } from '../corner.js';
import { GFX_CHOICES, TIER_NAME, gfxPick, setGfxPick, onGfxPick, liveTier, onLiveTier } from '../gfxPrefs.js';   // GRAPHICS (README, Performance, Chromebooks)
import { bestOf, roundTime, stepBestOf, stepRoundTime, timeLabel } from '../flow/rules.js';   // GAME: the match rules
import { botchEnabled, setBotchEnabled } from '../flow/techniques.js';                       // GAME: the botch switch

const TABS = [['game', 'GAME'], ['audio', 'AUDIO'], ['display', 'DISPLAY']];
const CHEV = (d) => `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${d < 0 ? 'M11.5 2.5 L5 9 L11.5 15.5' : 'M6.5 2.5 L13 9 L6.5 15.5'}"/></svg>`;
/** a choice's row: the name (and a line on what it does) on the left, ‹ VALUE › on the right */
const opt = (k, label, sub = '') => `<div class="sf-opt" data-o="${k}"><div class="sf-olabel"><label>${label}</label>${sub ? `<small>${sub}</small>` : ''}</div>`
  + `<div class="sf-val"><button class="sf-arr" data-d="-1" type="button" aria-label="${label.toLowerCase()}: previous">${CHEV(-1)}</button><b></b>`
  + `<button class="sf-arr" data-d="1" type="button" aria-label="${label.toLowerCase()}: next">${CHEV(1)}</button></div></div>`;


export function createSoundUI({ settings, music, actions, isUnlocked }) {
  if (typeof document === 'undefined') return { update() {}, close() {}, open() {}, key() { return false; }, isOpen: false };
  injectStyle();
  const isTouch = () => document.documentElement.classList.contains('touch-ui');

  // the desktop menu button and its "press a key" hint, which sits beside the row it's in
  const btn = cornerButton('sf-menu', 'Settings', 2, MENU_ICON);
  const hint = el('div', 'sf-hint');
  cornerRow().appendChild(hint);
  btn.addEventListener('click', () => { actions.click(); toggle(); });

  const panel = el('div', 'sf-panel', { role: 'dialog', 'aria-label': 'Settings' });
  panel.innerHTML = `
    <div class="sf-head"><button class="sf-close" type="button" aria-label="Close settings">${CHEV(-1)}</button><h2>SETTINGS</h2></div>
    <div class="sf-tabs" role="tablist">${TABS.map(([k, n]) => `<button class="sf-tab" data-t="${k}" type="button" role="tab">${n}</button>`).join('')}</div>
    <div class="sf-page" data-p="game">
      ${opt('rounds', 'ROUNDS', 'ROUNDS TO WIN A MATCH')}
      ${opt('time', 'ROUND TIME', 'THE CLOCK ON EACH ROUND')}
      ${opt('botch', 'BOTCHES', 'A PRESS AT THE WRONG TIME STUMBLES')}
      <p class="sf-note">THESE START WITH THE NEXT FIGHT. ONLINE, THE HOST'S RULES ARE THE ONES PLAYED. HORDE HAS NO ROUNDS OR CLOCK.</p>
    </div>
    <div class="sf-page" data-p="audio">
      <div class="sf-row">
        <button class="sf-sw" data-k="sound" type="button"><span>SOUND</span><b></b></button>
        <button class="sf-sw" data-k="music" type="button"><span>MUSIC</span><b></b></button>
      </div>
      <div class="sf-now">
        <div class="sf-track"><span class="sf-name"></span><span class="sf-mood"></span></div>
        <button class="sf-next" type="button" aria-label="Next track">NEXT</button>
      </div>
      <div class="sf-meter"><i></i></div>
      <div class="sf-slider" data-k="musicVolume"><label>MUSIC</label><div class="sf-rail"><div class="sf-fill"></div><div class="sf-knob"></div></div><output></output></div>
      <div class="sf-slider" data-k="sfxVolume"><label>EFFECTS</label><div class="sf-rail"><div class="sf-fill"></div><div class="sf-knob"></div></div><output></output></div>
      <p class="sf-keys">M MUSIC ON/OFF &nbsp; N NEXT TRACK</p>
    </div>
    <div class="sf-page" data-p="display">
      ${opt('gfx', 'GRAPHICS', 'LOWER RUNS SMOOTHER ON A SLOW DEVICE')}
      <p class="sf-note sf-gfx-note"></p>
      <div class="sf-size">
        <div class="sf-size-head"><label>TOUCH CONTROLS</label><span class="sf-size-name"></span></div>
        <div class="sf-size-row">
          <button class="sf-step" data-d="-1" type="button" aria-label="Smaller controls">&minus;</button>
          <div class="sf-pips">${TOUCH_STEPS.map((st, i) => `<button class="sf-pip" data-i="${i}" type="button" aria-label="${st.name}"><i style="--d:${(0.5 + i * 0.22).toFixed(2)}rem"></i></button>`).join('')}</div>
          <button class="sf-step" data-d="1" type="button" aria-label="Bigger controls">+</button>
          <button class="sf-reset" type="button">RESET</button>
        </div>
      </div>
    </div>
    <div class="sf-foot">
      <p class="sf-credit">MUSIC MADE WITH <a href="https://strudel.cc" target="_blank" rel="noopener">STRUDEL</a> (<a href="https://codeberg.org/uzu/strudel" target="_blank" rel="noopener">AGPL-3.0</a>) &nbsp;·&nbsp; GAME <a href="https://github.com/ddrscott/stick-fight" target="_blank" rel="noopener">SOURCE</a></p>
      <p class="sf-credit sf-legal"><a href="${rootUrl('privacy/').href}" target="_blank" rel="noopener">PRIVACY</a> &nbsp;·&nbsp; <a href="${rootUrl('terms/').href}" target="_blank" rel="noopener">HOUSE RULES</a></p>
    </div>`;
  panel.dataset.scroll = 'y';   // taller than the screen (a phone sideways with Safari's bars up), it scrolls by finger: touch.js
  document.body.appendChild(panel);
  const $ = (s) => panel.querySelector(s);
  // keep the panel's touches away from the fight: no synthetic mouse events reach the game
  for (const t of ['touchstart', 'pointerdown', 'mousedown']) panel.addEventListener(t, (e) => e.stopPropagation());

  $('.sf-close').addEventListener('click', () => { actions.click('off'); close(); });
  panel.querySelectorAll('.sf-sw').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k, on = !(settings[k] && (k === 'sound' || settings.sound));
    actions.click(on ? 'on' : 'off');
    if (k === 'sound') actions.setSound(on); else actions.setMusic(on);
  }));
  $('.sf-next').addEventListener('click', () => { actions.click(); actions.next(); });

  panel.querySelectorAll('.sf-slider').forEach((row) => {
    const k = row.dataset.k, rail = row.querySelector('.sf-rail');
    let dragging = false;
    const setFrom = (e) => {
      const r = rail.getBoundingClientRect();
      const v = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 100;
      if (k === 'musicVolume') actions.setMusicVolume(v); else actions.setSfxVolume(v);
      paintSlider(row, v);
    };
    rail.addEventListener('pointerdown', (e) => { dragging = true; try { rail.setPointerCapture(e.pointerId); } catch (_) {} setFrom(e); e.preventDefault(); });
    rail.addEventListener('pointermove', (e) => { if (dragging) setFrom(e); });
    const end = () => { if (!dragging) return; dragging = false; if (k === 'sfxVolume') actions.sfxPreview(); };   // letting go plays one, so you hear the level
    rail.addEventListener('pointerup', end); rail.addEventListener('pointercancel', end);
  });

  // CONTROLS: the touch layer's size. Each press saves it and the layer redraws behind the panel.
  const pickStep = (i) => {
    const n = Math.max(0, Math.min(TOUCH_STEPS.length - 1, i));
    actions.click(n === touchStep() ? 'off' : 'on');
    if (n !== touchStep()) setTouchScale(TOUCH_STEPS[n].scale);
  };
  panel.querySelectorAll('.sf-step').forEach((b) => b.addEventListener('click', () => pickStep(touchStep() + Number(b.dataset.d))));
  panel.querySelectorAll('.sf-pip').forEach((b) => b.addEventListener('click', () => pickStep(Number(b.dataset.i))));
  $('.sf-reset').addEventListener('click', () => { actions.click(); setTouchScale(TOUCH_DEFAULT); });
  function paintSize() {
    const at = touchStep(), last = TOUCH_STEPS.length - 1;
    // touch.js caps the size at what this screen holds without the controls touching, and this says so
    $('.sf-size-name').textContent = TOUCH_STEPS[at].name + (touchFit.clamped ? ` · SCREEN FITS ${Math.round(touchFit.scale * 100)}%` : '');
    panel.querySelectorAll('.sf-pip').forEach((b, i) => { b.classList.toggle('sf-on', i === at); b.classList.toggle('sf-under', i < at); });
    $('.sf-step[data-d="-1"]').disabled = at === 0;
    $('.sf-step[data-d="1"]').disabled = at === last;
    $('.sf-reset').disabled = touchPref().scale === TOUCH_DEFAULT;
  }
  onTouchPref(paintSize);

  // GRAPHICS: AUTO (the adaptive tier, the default) or a fixed tier, which turns adaptation off. Under it, what AUTO is
  // drawing at right now, the way TOUCH CONTROLS says SCREEN FITS (src/gfxPrefs.js; src/main.js applies the choice).
  const pickGfx = (id) => { actions.click(id === gfxPick() ? 'off' : 'on'); setGfxPick(id); };
  function paintGfx() {
    const pick = gfxPick(), live = liveTier();
    const c = GFX_CHOICES.find((x) => x.id === pick) || GFX_CHOICES[0];
    $('.sf-opt[data-o="gfx"] .sf-val b').textContent = c.name;
    $('.sf-gfx-note').textContent = pick === 'auto' ? (live >= 0 ? `AUTO PICKS FOR THIS DEVICE. DRAWING AT ${TIER_NAME[live]} NOW.` : 'AUTO PICKS FOR THIS DEVICE.') : 'FIXED: IT STAYS HERE EVEN IF THE GAME SLOWS DOWN.';
  }
  onGfxPick(paintGfx); onLiveTier(paintGfx);

  // GAME: the match rules and the botch switch (they take effect from the next fight)
  const OPTS = {
    rounds: { step: (d) => stepBestOf(d), text: () => `BEST OF ${bestOf()}` },
    time: { step: (d) => stepRoundTime(d), text: () => (roundTime() ? `${roundTime()} SECONDS` : timeLabel(0)) },
    botch: { step: () => setBotchEnabled(!botchEnabled()), text: () => (botchEnabled() ? 'ON' : 'OFF') },
    gfx: { step: (d) => { const at = GFX_CHOICES.findIndex((c) => c.id === gfxPick()), to = GFX_CHOICES[(at + d + GFX_CHOICES.length) % GFX_CHOICES.length]; pickGfx(to.id); }, text: null },
  };
  function stepOpt(k, d) {
    const o = OPTS[k]; if (!o) return;
    if (k !== 'gfx') actions.click(d > 0 ? 'on' : 'off');
    o.step(d); paintGame();
  }
  function paintGame() {
    for (const [k, o] of Object.entries(OPTS)) if (o.text) $(`.sf-opt[data-o="${k}"] .sf-val b`).textContent = o.text();
    paintGfx();
  }
  panel.querySelectorAll('.sf-opt').forEach((row) => {
    const k = /** @type {HTMLElement} */ (row).dataset.o;
    row.addEventListener('click', (e) => {
      const arr = /** @type {Element} */ (e.target).closest('.sf-arr');
      stepOpt(k, arr ? Number(/** @type {HTMLElement} */ (arr).dataset.d) : 1);
    });
  });

  // the tabs: one page at a time, the last one picked is where it opens next time (this visit)
  let tab = 'game';
  function showTab(t, sound = false) {
    if (!TABS.some(([k]) => k === t)) return;
    if (sound && t !== tab) actions.click();
    tab = t;
    panel.querySelectorAll('.sf-tab').forEach((b) => { const on = /** @type {HTMLElement} */ (b).dataset.t === t; b.classList.toggle('sf-on', on); b.setAttribute('aria-selected', String(on)); });
    panel.querySelectorAll('.sf-page').forEach((p) => p.classList.toggle('sf-show', /** @type {HTMLElement} */ (p).dataset.p === t));
    panel.scrollTop = 0;
  }
  panel.querySelectorAll('.sf-tab').forEach((b) => b.addEventListener('click', () => showTab(/** @type {HTMLElement} */ (b).dataset.t, true)));
  showTab('game');
  paintGame();

  // the touch layer's menu button, and a click for its small buttons
  window.addEventListener('sf:settings', () => toggle());
  document.addEventListener('touchstart', (e) => {
    const t = e.target instanceof Element && e.target.closest('.tc-top .tc-btn');
    if (t) actions.click();
  }, { passive: true, capture: true });

  let open = false, raf = 0;
  function toggle() { if (open) close(); else show(); }
  const preview = (on) => document.documentElement.classList.toggle('tc-preview', on && isTouch());
  /** keys: opened from a key or the pad, so the cursor shows at once (a click or a tap shows none until a key is used) */
  function show({ keys = false } = {}) {
    if (open) return;
    open = true; panel.classList.add('sf-open'); preview(true); update(); paintGame(); meterLoop();
    setCursor(keys ? navItems().find((it) => it.tab) || navItems()[0] : null);
  }
  function close() {
    if (!open) return;
    open = false; panel.classList.remove('sf-open'); preview(false); cancelAnimationFrame(raf); setCursor(null);
    window.dispatchEvent(new CustomEvent('sf:settings-closed'));   // the flow hands the keys back to the menu under it
  }
  // Escape closes the panel and nothing else: caught before the menus, the pause key and the online LEAVE confirm
  window.addEventListener('keydown', (e) => {
    if (!open || e.code !== 'Escape') return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!e.repeat) { actions.click('off'); close(); }
  }, { capture: true });

  // ---- keys and the pad ----------------------------------------------------------------------
  // The cursor's stops, top to bottom, leaving out what this screen doesn't show (CONTROLS on a desktop)
  // or can't press (a dim RESET). SOUND and MUSIC share a row: left and right go between them.
  let cursor = null;
  const navItems = () => [
    { el: $(`.sf-tab[data-t="${tab}"]`), tab: true },
    ...(tab === 'game' ? [{ el: $('.sf-opt[data-o="rounds"]'), opt: 'rounds' }, { el: $('.sf-opt[data-o="time"]'), opt: 'time' }, { el: $('.sf-opt[data-o="botch"]'), opt: 'botch' }] : []),
    ...(tab === 'audio' ? [
      { el: $('.sf-sw[data-k="sound"]'), row: 0 }, { el: $('.sf-sw[data-k="music"]'), row: 0 },
      { el: $('.sf-next') },
      { el: $('.sf-slider[data-k="musicVolume"]'), slide: 'musicVolume' }, { el: $('.sf-slider[data-k="sfxVolume"]'), slide: 'sfxVolume' },
    ] : []),
    ...(tab === 'display' ? [{ el: $('.sf-opt[data-o="gfx"]'), opt: 'gfx' }, { el: $('.sf-pips'), size: true }, { el: $('.sf-reset') }] : []),
  ].filter((it) => it.el && it.el.offsetParent !== null && !(/** @type {any} */ (it.el)).disabled);
  function setCursor(it) {
    if (cursor) cursor.classList.remove('sf-focus');
    cursor = it ? it.el : null;
    if (cursor) { cursor.classList.add('sf-focus'); if (cursor.scrollIntoView) cursor.scrollIntoView({ block: 'nearest' }); }
  }
  /** a menu key (src/flow/menuInput.js) while the panel is open; true when the panel took it */
  function key(k) {
    if (!open) return false;
    if (k === 'back' || k === 'escape' || k === 'select' || k === 'start' || k === 'pause') { actions.click('off'); close(); return true; }
    const its = navItems(), i = its.findIndex((it) => it.el === cursor);
    if (i < 0) { if (its.length && k !== 'moves' && k !== 'del') setCursor(its[0]); return true; }   // the first key only shows the cursor
    const it = its[i], d = k === 'down' || k === 'right' ? 1 : -1;
    if (it.tab && (k === 'left' || k === 'right')) {   // the tab row: left and right switch the page
      const at = TABS.findIndex(([t]) => t === tab), to = TABS[(at + d + TABS.length) % TABS.length][0];
      showTab(to, true); setCursor(navItems()[0]); return true;
    }
    if (k === 'up' || k === 'down') {
      let j = i + d;
      if (it.row !== undefined && its[j] && its[j].row === it.row) j += d;   // out of the row, not along it
      if (its[j]) { actions.click(); setCursor(its[j]); }
    } else if (k === 'left' || k === 'right') {
      if (it.slide) {
        const v = Math.round(Math.max(0, Math.min(1, settings[it.slide] + d * 0.05)) * 100) / 100;
        if (it.slide === 'musicVolume') actions.setMusicVolume(v); else { actions.setSfxVolume(v); actions.sfxPreview(); }
      } else if (it.size) pickStep(touchStep() + d);
      else if (it.opt) stepOpt(it.opt, d);
      else if (it.row !== undefined && its[i + d] && its[i + d].row === it.row) { actions.click(); setCursor(its[i + d]); }
    } else if (k === 'confirm' && it.opt) stepOpt(it.opt, 1);
    else if (k === 'confirm' && it.el.tagName === 'BUTTON') {
      (/** @type {HTMLElement} */ (it.el)).click();
      if (open && cursor && (/** @type {any} */ (cursor)).disabled) setCursor(navItems()[0]);   // RESET just went dim under the cursor
    }
    return true;
  }
  function meterLoop() {
    if (!open) return;
    const lv = music.state.playing ? music.level() : 0;
    $('.sf-meter i').style.transform = `scaleX(${lv.toFixed(3)})`;
    raf = requestAnimationFrame(meterLoop);
  }
  function paintSlider(row, v) {
    row.querySelector('.sf-fill').style.width = `${v * 100}%`;
    row.querySelector('.sf-knob').style.left = `${v * 100}%`;
    row.querySelector('output').textContent = String(Math.round(v * 100));
  }

  function update() {
    const unlocked = isUnlocked();
    const soundOn = settings.sound, musicOn = settings.sound && settings.music;
    const sw = (k, on) => { const b = panel.querySelector(`.sf-sw[data-k="${k}"]`); b.classList.toggle('sf-on', on); b.querySelector('b').textContent = on ? 'ON' : 'OFF'; };
    sw('sound', soundOn); sw('music', musicOn);
    const t = music.tracks[music.state.track];
    $('.sf-name').textContent = t ? t.name.toUpperCase() : '';   // upper case, like everything else in the panel
    $('.sf-mood').textContent = music.state.loading ? 'LOADING…' : music.state.error ? 'MUSIC ERROR' : musicOn && !unlocked ? 'TAP OR PRESS A KEY TO START' : t ? `${t.bpm} BPM` : '';
    paintSlider(panel.querySelector('[data-k="musicVolume"]'), settings.musicVolume);
    paintSlider(panel.querySelector('[data-k="sfxVolume"]'), settings.sfxVolume);
    paintSize();
    // the buttons show sound off, and pulse while sound is wanted but still locked
    const locked = soundOn && !unlocked;
    const touchBtn = document.querySelector('[data-role="settings"]');
    for (const b of [btn, touchBtn]) if (b) { b.classList.toggle('sf-muted', !soundOn); b.classList.toggle('sf-locked', locked); }
    hint.textContent = locked && !isTouch() ? 'PRESS ANY KEY FOR SOUND' : '';
    hint.classList.toggle('sf-show', locked && !isTouch());
  }
  update();
  // touch.js builds its layer after this module runs; pick its button up once it's there
  setTimeout(update, 0); setTimeout(update, 600);
  return { update, close, open: show, key, get isOpen() { return open; } };
}

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag); n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function injectStyle() {
  if (document.getElementById('sf-sound-style')) return;
  const css = `
  .sf-panel, .sf-hint { --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff; --ink: #fff4fd; --face: rgba(10,3,22,0.985); }
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

  .sf-panel {
    position: fixed; left: 50%; top: 50%; z-index: 40; transform: translate(-50%, -50%) scale(0.96);
    width: min(400px, calc(100vw - 24px)); max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); overflow: auto; box-sizing: border-box;
    padding: 12px 14px 10px; background: var(--face); color: var(--ink);
    border: 2px solid var(--pink); border-radius: 2px;
    box-shadow: 0 0 18px rgba(255,43,214,0.55), inset 0 0 22px rgba(255,43,214,0.12);
    font-family: 'Teko', 'Arial Narrow', sans-serif; opacity: 0; pointer-events: none; transition: opacity 120ms, transform 120ms;
    text-shadow: ${PLAIN};   /* settings are read, so the letters don't glow (README, "The look") */
    /* on a screen shorter than the panel it scrolls by finger (data-scroll, see touch.js); the sliders keep touch-action: none */
    touch-action: pan-y; overscroll-behavior: contain; -webkit-user-select: none; user-select: none;
  }
  .sf-panel.sf-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
  .sf-panel * { box-sizing: border-box; }
  .sf-panel button { font-family: 'Bungee', 'Arial Black', sans-serif; cursor: pointer; }
  /* the head: ‹ in the top left closes it, like every screen's back (README, Arcade flow, "Back and the corner") */
  .sf-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .sf-head h2 { margin: 0; font: 400 22px/1 'Bungee', 'Arial Black', sans-serif; letter-spacing: 0.06em; color: #ff8fe8; }
  .sf-close { width: 40px; height: 40px; flex: none; padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--violet);
    border: 2px solid var(--violet); border-radius: 0; }
  .sf-close svg, .sf-arr svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 3.2; stroke-linecap: square; }
  .sf-close:hover { background: var(--violet); color: #12041f; }
  /* three tabs, the page under them; the picked tab filled */
  .sf-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
  .sf-tab { flex: 1 1 0; height: 40px; padding: 0; background: transparent; color: rgba(255,244,253,0.7); border: 2px solid rgba(46,242,255,0.45); border-radius: 0;
    font-size: 13px; letter-spacing: 0.06em; }
  .sf-tab.sf-on { color: #0a0414; background: var(--cyan); border-color: var(--cyan); text-shadow: none; }
  .sf-page { display: none; }
  .sf-page.sf-show { display: block; }
  /* a choice: its name and what it does on the left, ‹ VALUE › on the right, the whole row a button */
  .sf-opt { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 52px; padding: 6px 0; cursor: pointer;
    border-bottom: 2px solid rgba(166,107,255,0.22); }
  .sf-olabel { display: flex; flex-direction: column; min-width: 0; line-height: 1; }
  .sf-olabel label { font-size: 20px; font-weight: 600; letter-spacing: 0.06em; color: var(--cyan); cursor: pointer; }
  .sf-olabel small { margin-top: 3px; font-size: 15px; font-weight: 500; letter-spacing: 0.04em; color: rgba(255,244,253,0.7); }
  .sf-val { display: flex; align-items: center; gap: 4px; flex: none; }
  .sf-val b { min-width: 7.4em; text-align: center; font: 600 20px/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.06em; color: var(--amber); padding-top: 3px; }
  .sf-arr { width: 36px; height: 36px; padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--amber);
    border: 2px solid rgba(255,176,46,0.6); border-radius: 0; }
  .sf-arr:hover, .sf-arr:active { background: var(--amber); color: #12041f; }
  .sf-note { margin: 8px 0 2px; font-size: 15px; line-height: 1.15; letter-spacing: 0.05em; color: rgba(255,244,253,0.72); }
  .sf-foot { margin-top: 10px; padding-top: 6px; border-top: 2px solid rgba(166,107,255,0.3); }
  .sf-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .sf-sw { flex: 1; display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 10px;
    background: rgba(46,242,255,0.05); color: rgba(255,244,253,0.7); border: 2px solid rgba(166,107,255,0.5); border-radius: 0;
    font-size: 13px; letter-spacing: 0.05em; }
  .sf-sw b { font-weight: 400; color: var(--violet); }
  .sf-sw.sf-on { color: var(--ink); border-color: var(--cyan); box-shadow: 0 0 10px rgba(46,242,255,0.55), inset 0 0 8px rgba(46,242,255,0.2); }
  .sf-sw.sf-on b { color: var(--cyan); }
  .sf-now { display: flex; align-items: center; gap: 8px; }
  .sf-track { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1; }
  .sf-name { font-size: 26px; font-weight: 600; letter-spacing: 0.03em; color: var(--amber);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sf-mood { font-size: 16px; font-weight: 500; color: rgba(255,244,253,0.6); letter-spacing: 0.04em; margin-top: 2px; }
  .sf-next { height: 40px; padding: 0 12px; background: transparent; color: var(--amber); border: 2px solid var(--amber);
    border-radius: 0; font-size: 13px; }
  .sf-next:active, .sf-sw:active, .sf-close:active { transform: scale(0.95); }
  /* the cursor of a keyboard or a pad: a full outline, never a one-edge rail */
  .sf-panel .sf-focus { outline: 2px solid var(--ink); outline-offset: 2px; }
  .sf-panel .sf-opt.sf-focus { outline-offset: 0; background: rgba(46,242,255,0.08); }
  .sf-panel button:focus { outline: none; } .sf-panel button.sf-focus:focus { outline: 2px solid var(--ink); }
  .sf-meter { height: 4px; margin: 8px 0 10px; background: rgba(166,107,255,0.18); overflow: hidden; }
  .sf-meter i { display: block; height: 100%; background: var(--amber); box-shadow: 0 0 6px var(--amber); transform-origin: left; transform: scaleX(0); }
  .sf-slider { display: grid; grid-template-columns: 62px 1fr 30px; align-items: center; gap: 8px; height: 34px; }
  .sf-slider label { font-size: 18px; font-weight: 600; letter-spacing: 0.06em; color: var(--cyan); }
  .sf-slider output { font-size: 18px; font-weight: 500; text-align: right; color: rgba(255,244,253,0.75); }
  .sf-rail { position: relative; height: 30px; cursor: pointer; touch-action: none; }
  .sf-rail::before { content: ''; position: absolute; left: 0; right: 0; top: 13px; height: 4px; background: rgba(166,107,255,0.3); }
  .sf-fill { position: absolute; left: 0; top: 13px; height: 4px; background: var(--cyan); box-shadow: 0 0 6px var(--cyan); }
  .sf-knob { position: absolute; top: 6px; width: 12px; height: 18px; margin-left: -6px; background: var(--ink);
    border: 2px solid var(--cyan); border-radius: 2px; box-shadow: 0 0 8px var(--cyan); }
  /* CONTROLS: touch only. Five rings that grow, the picked one lit. */
  .sf-size { display: none; margin-top: 10px; }
  html.touch-ui .sf-size { display: block; }
  .sf-size-head { display: flex; align-items: baseline; justify-content: space-between; }
  .sf-size-head label { font-size: 18px; font-weight: 600; letter-spacing: 0.06em; color: var(--cyan); }
  .sf-size-name { font-size: 18px; font-weight: 600; letter-spacing: 0.06em; white-space: nowrap; color: var(--amber); }
  .sf-size-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .sf-step, .sf-reset { height: 36px; padding: 0; background: transparent; color: var(--cyan); border: 2px solid var(--cyan);
    border-radius: 2px; box-shadow: 0 0 8px rgba(46,242,255,0.5); }
  .sf-step { width: 36px; font-size: 18px; line-height: 1; }
  .sf-reset { padding: 0 9px; font-size: 13px; letter-spacing: 0.05em; color: var(--pink); border-color: var(--pink); box-shadow: 0 0 8px rgba(255,43,214,0.5); }
  .sf-step:disabled, .sf-reset:disabled { opacity: 0.3; box-shadow: none; }
  .sf-step:active, .sf-reset:active, .sf-pip:active { transform: scale(0.95); }
  .sf-pips { flex: 1; display: flex; align-items: center; justify-content: space-between; height: 36px; }
  .sf-pip { flex: 1; height: 36px; padding: 0; background: transparent; border: 0; display: flex; align-items: center; justify-content: center; }
  .sf-pip i { display: block; width: var(--d); height: var(--d); border: 2px solid rgba(166,107,255,0.6); border-radius: 50%; }
  .sf-pip.sf-under i { border-color: var(--cyan); }
  .sf-pip.sf-on i { background: var(--cyan); border-color: var(--ink); box-shadow: 0 0 10px var(--cyan), 0 0 3px var(--cyan); }
  /* held upright, the panel sits over the stage so the controls under it stay in view */
  @media (orientation: portrait) {
    html.touch-ui .sf-panel { top: calc(env(safe-area-inset-top) + 8px); transform: translate(-50%, 0) scale(0.96); }
    html.touch-ui .sf-panel.sf-open { transform: translate(-50%, 0) scale(1); }
    /* and every control in it is a thumb's size (44 px tall), not a mouse's */
    html.touch-ui .sf-close, html.touch-ui .sf-arr { width: 44px; height: 44px; }
    html.touch-ui .sf-tab { height: 44px; }
    html.touch-ui .sf-sw, html.touch-ui .sf-next { height: 44px; font-size: 13px; }
    html.touch-ui .sf-step, html.touch-ui .sf-reset, html.touch-ui .sf-pips, html.touch-ui .sf-pip { height: 44px; }
    html.touch-ui .sf-step { width: 44px; }
    html.touch-ui .sf-reset { font-size: 13px; }
  }
  .sf-keys { margin: 6px 0 0; font-size: 15px; letter-spacing: 0.08em; color: rgba(255,244,253,0.65); }
  html.touch-ui .sf-keys { display: none; }
  .sf-credit { margin: 6px 0 0; font-size: 14px; letter-spacing: 0.08em; color: rgba(255,244,253,0.65); }
  .sf-credit a { color: #4df3ff; text-decoration: none; border-bottom: 1px solid rgba(77,243,255,0.4); }`;
  const s = document.createElement('style');
  s.id = 'sf-sound-style';
  s.textContent = css;
  document.head.appendChild(s);
}
