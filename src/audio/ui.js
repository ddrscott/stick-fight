// The sound settings panel: SOUND and MUSIC switches, the track playing with NEXT, a meter,
// and MUSIC and EFFECTS sliders. Opened from a small speaker button in the stage's bottom
// left corner on desktop, or from the touch layer's SOUND button (touch.js sends
// 'sf:sound-panel'), which sits in the top-right gutter beside HORDE. Neon arcade look:
// Bungee and Teko (loaded by index.html), the touch layer's palette, hard corners.
//
// The sliders are drawn here and driven by pointer events, because touch.js cancels every
// touchmove on the page and a native range input on Android needs those.

import { PLAIN } from '../plaintext.js';   // readable text never glows: the shared dark outline

const SPEAKER = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path class="sf-wave" d="M11 5.5c1 .8 1 4.2 0 5M12.8 3.8c2 1.8 2 6.6 0 8.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="sf-x" d="M11 6l4 4M15 6l-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export function createSoundUI({ settings, music, actions, isUnlocked }) {
  if (typeof document === 'undefined') return { update() {}, close() {} };
  injectStyle();
  const isTouch = () => document.documentElement.classList.contains('touch-ui');

  // desktop button and its "press a key" hint
  const host = document.getElementById('stage') || document.body;
  const btn = el('button', 'sf-btn', { 'aria-label': 'Sound settings', type: 'button' });
  btn.innerHTML = SPEAKER;
  const hint = el('div', 'sf-hint');
  host.appendChild(btn); host.appendChild(hint);
  btn.addEventListener('click', () => { actions.click(); toggle(); });

  const panel = el('div', 'sf-panel', { role: 'dialog', 'aria-label': 'Sound' });
  panel.innerHTML = `
    <div class="sf-head"><h2>SOUND</h2><button class="sf-close" type="button" aria-label="Close">X</button></div>
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
    <p class="sf-credit">MUSIC MADE WITH <a href="https://strudel.cc" target="_blank" rel="noopener">STRUDEL</a> (<a href="https://codeberg.org/uzu/strudel" target="_blank" rel="noopener">AGPL-3.0</a>) &nbsp;·&nbsp; GAME <a href="https://github.com/ddrscott/stick-fight" target="_blank" rel="noopener">SOURCE</a></p>`;
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

  // the touch layer's SOUND button, and a click for its small buttons
  window.addEventListener('sf:sound-panel', () => toggle());
  document.addEventListener('touchstart', (e) => {
    const t = e.target instanceof Element && e.target.closest('.tc-top .tc-btn');
    if (t) actions.click();
  }, { passive: true, capture: true });

  let open = false, raf = 0;
  function toggle() { if (open) close(); else show(); }
  function show() { open = true; panel.classList.add('sf-open'); update(); meterLoop(); }
  function close() { open = false; panel.classList.remove('sf-open'); cancelAnimationFrame(raf); }
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
    $('.sf-name').textContent = t ? t.name : '';
    $('.sf-mood').textContent = music.state.loading ? 'loading…' : music.state.error ? 'music error' : musicOn && !unlocked ? 'tap or press a key to start' : t ? `${t.bpm} BPM` : '';
    paintSlider(panel.querySelector('[data-k="musicVolume"]'), settings.musicVolume);
    paintSlider(panel.querySelector('[data-k="sfxVolume"]'), settings.sfxVolume);
    // the buttons show sound off, and pulse while sound is wanted but still locked
    const locked = soundOn && !unlocked;
    const touchBtn = document.querySelector('[data-role="sound"]');
    for (const b of [btn, touchBtn]) if (b) { b.classList.toggle('sf-muted', !soundOn); b.classList.toggle('sf-locked', locked); }
    if (touchBtn && !touchBtn.querySelector('svg')) touchBtn.innerHTML = SPEAKER;
    hint.textContent = locked && !isTouch() ? 'PRESS ANY KEY FOR SOUND' : '';
    hint.classList.toggle('sf-show', locked && !isTouch());
  }
  update();
  // touch.js builds its layer after this module runs; pick its button up once it's there
  setTimeout(update, 0); setTimeout(update, 600);
  return { update, close };
}

function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag); n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function injectStyle() {
  if (document.getElementById('sf-sound-style')) return;
  const css = `
  .sf-btn, .sf-panel, .sf-hint { --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff; --ink: #fff4fd; --face: rgba(10,3,22,0.94); }
  .sf-btn {
    position: absolute; left: 10px; bottom: 8px; z-index: 5; width: 30px; height: 30px; padding: 0;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    background: rgba(14,4,30,0.55); color: var(--cyan); border: 2px solid var(--cyan); border-radius: 2px;
    box-shadow: 0 0 8px rgba(46,242,255,0.55); opacity: 0.6; transition: opacity 120ms;
  }
  .sf-btn:hover, .sf-btn:focus-visible { opacity: 1; outline: none; }
  html.touch-ui .sf-btn, html.touch-ui .sf-hint { display: none; }
  .sf-btn svg, [data-role="sound"] svg { filter: drop-shadow(0 0 3px currentColor); }
  .sf-x { display: none; }
  .sf-muted .sf-wave { display: none; } .sf-muted .sf-x { display: inline; }
  .sf-btn.sf-muted { color: var(--pink); border-color: var(--pink); box-shadow: 0 0 8px rgba(255,43,214,0.5); }
  .sf-locked { animation: sf-pulse 1.1s ease-in-out infinite; }
  @keyframes sf-pulse { 50% { box-shadow: 0 0 18px var(--amber, #ffb02e), 0 0 4px var(--amber, #ffb02e); } }
  .sf-hint {
    position: absolute; left: 48px; bottom: 12px; z-index: 5; pointer-events: none; opacity: 0;
    font: 500 17px/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.08em; color: var(--amber);
    text-shadow: ${PLAIN}; transition: opacity 200ms;   /* a hint to read: no glow */
  }
  .sf-hint.sf-show { opacity: 0.9; }

  .sf-panel {
    position: fixed; left: 50%; top: 50%; z-index: 40; transform: translate(-50%, -50%) scale(0.96);
    width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 24px); overflow: auto; box-sizing: border-box;
    padding: 12px 14px 10px; background: var(--face); color: var(--ink);
    border: 2px solid var(--pink); border-radius: 2px;
    box-shadow: 0 0 18px rgba(255,43,214,0.55), inset 0 0 22px rgba(255,43,214,0.12);
    font-family: 'Teko', 'Arial Narrow', sans-serif; opacity: 0; pointer-events: none; transition: opacity 120ms, transform 120ms;
    text-shadow: ${PLAIN};   /* settings are read, so the letters don't glow (README, "The look") */
    touch-action: none; -webkit-user-select: none; user-select: none;
  }
  .sf-panel.sf-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
  .sf-panel * { box-sizing: border-box; }
  .sf-panel button { font-family: 'Bungee', 'Arial Black', sans-serif; cursor: pointer; }
  .sf-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .sf-head h2 { margin: 0; font: 400 22px/1 'Bungee', 'Arial Black', sans-serif; letter-spacing: 0.06em;
    color: #ff8fe8; }
  .sf-close { width: 30px; height: 30px; padding: 0; background: transparent; color: var(--pink);
    border: 2px solid var(--pink); border-radius: 2px; font-size: 13px; box-shadow: 0 0 8px rgba(255,43,214,0.5); }
  .sf-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .sf-sw { flex: 1; display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 10px;
    background: rgba(46,242,255,0.05); color: rgba(255,244,253,0.55); border: 2px solid rgba(166,107,255,0.5); border-radius: 2px;
    font-size: 12px; letter-spacing: 0.05em; }
  .sf-sw b { font-weight: 400; color: var(--violet); }
  .sf-sw.sf-on { color: var(--ink); border-color: var(--cyan); box-shadow: 0 0 10px rgba(46,242,255,0.55), inset 0 0 8px rgba(46,242,255,0.2); }
  .sf-sw.sf-on b { color: var(--cyan); }
  .sf-now { display: flex; align-items: center; gap: 8px; }
  .sf-track { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1; }
  .sf-name { font-size: 26px; font-weight: 600; letter-spacing: 0.03em; color: var(--amber);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sf-mood { font-size: 16px; font-weight: 500; color: rgba(255,244,253,0.6); letter-spacing: 0.04em; margin-top: 2px; }
  .sf-next { height: 34px; padding: 0 12px; background: transparent; color: var(--amber); border: 2px solid var(--amber);
    border-radius: 2px; font-size: 12px; box-shadow: 0 0 8px rgba(255,176,46,0.5); }
  .sf-next:active, .sf-sw:active, .sf-close:active { transform: scale(0.95); }
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
  .sf-keys { margin: 6px 0 0; font-size: 15px; letter-spacing: 0.08em; color: rgba(255,244,253,0.65); }
  html.touch-ui .sf-keys { display: none; }
  .sf-credit { margin: 8px 0 0; font-size: 14px; letter-spacing: 0.08em; color: rgba(255,244,253,0.65); }
  .sf-credit a { color: #4df3ff; text-decoration: none; border-bottom: 1px solid rgba(77,243,255,0.4); }`;
  const s = document.createElement('style');
  s.id = 'sf-sound-style';
  s.textContent = css;
  document.head.appendChild(s);
}
