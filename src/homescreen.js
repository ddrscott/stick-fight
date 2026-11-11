// iPhone and iPad Safari: the way to full screen is the home screen (README, "Install as an app").
//
// Safari there has no Fullscreen API and no install prompt, and its bars take a third of a phone held
// sideways. So on that browser, and only until the game is on the home screen:
//
//   the pill      the touch layer keeps its fullscreen pill (src/touch.js) and it opens the how-to
//   the callout   PLAY FULL SCREEN, on every menu (never in a fight), until it's opened or closed once.
//                 A friend who scans a join link never sees the title's INSTALL button, so it can't
//                 live only there. Held upright it sits at the bottom of the screen, under the stage;
//                 held sideways it sits in the gutter left of the stage, and isn't shown when the
//                 gutter is too narrow for it (the pill is still there).
//   the how-to    three steps over the whole screen, sized to fit a 280px-tall window. Opened by the
//                 pill, the callout, the title's INSTALL button, or window's 'sf:homescreen' event.
//
// Everything is "sf-" classed, which keeps the attract screen's tap-to-start off it (main.js).
import { install } from './install.js';
import { PLAIN } from './plaintext.js';

const KEY = 'sf-homescreen-seen';
const SHARE = '<svg viewBox="0 0 20 20" width="1em" height="1em" aria-hidden="true"><path d="M10 2v11M6 6l4-4 4 4M4 10v7h12v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** true where the helper applies: iPhone/iPad Safari, in a tab, not in the homepage's frame */
export const homescreenHelp = install.kind === 'ios';

let panel = null, tip = null;
const seen = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } if (tip) { tip.remove(); tip = null; } };

function style() {
  if (document.getElementById('sf-hs-style')) return;
  const s = document.createElement('style');
  s.id = 'sf-hs-style';
  s.textContent = `
  .sf-hs-tip, .sf-hs { --amber: #ffb02e; --cyan: #2ef2ff; --pink: #ff2bd6; font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif; box-sizing: border-box; }
  .sf-hs-tip *, .sf-hs * { box-sizing: border-box; }
  /* the callout */
  .sf-hs-tip { position: fixed; z-index: 21; display: none; align-items: stretch; background: rgba(10,3,22,0.92); border: 2px solid var(--amber);
    left: max(0.75rem, env(safe-area-inset-left)); right: max(0.75rem, env(safe-area-inset-right)); bottom: max(0.75rem, env(safe-area-inset-bottom)); }
  html.flow-on:not(.fl-play) .sf-hs-tip.sf-hs-fits { display: flex; }
  .sf-hs-go, .sf-hs-x { appearance: none; margin: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; touch-action: manipulation; }
  .sf-hs-go { flex: 1; min-width: 0; min-height: 3rem; padding: 0.4rem 0.75rem; display: flex; flex-direction: column; justify-content: center; gap: 0.1rem; text-align: left; }
  .sf-hs-go b { font: 400 1rem/1.05 'Bungee', sans-serif; letter-spacing: 0.04em; color: var(--amber); }
  .sf-hs-go span { font-size: 1.05rem; line-height: 1; font-weight: 500; letter-spacing: 0.08em; color: #e8dcff; text-shadow: ${PLAIN}; }
  .sf-hs-x { flex: 0 0 2.75rem; min-height: 2.75rem; font: 400 0.9rem/1 'Bungee', sans-serif; color: var(--pink); border-left: 2px solid rgba(255,176,46,0.4); }
  @media (orientation: landscape) {
    /* in the gutter left of the stage: --hs-w is the room there, set by place() */
    .sf-hs-tip { right: auto; width: var(--hs-w, 5rem); flex-direction: column; }
    .sf-hs-go { padding: 0.4rem 0.3rem; align-items: center; text-align: center; }
    .sf-hs-go b { font-size: 0.8rem; }
    .sf-hs-go span { font-size: 0.9rem; }
    .sf-hs-x { flex: 0 0 auto; width: 100%; border-left: 0; border-top: 2px solid rgba(255,176,46,0.4); }
  }
  /* the how-to */
  .sf-hs { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(7,2,15,0.9);
    padding: max(0.5rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right)) max(0.5rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left)); }
  .sf-hs-box { width: min(34rem, 100%); max-height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.7rem 0.9rem;
    background: #0e041e; border: 2px solid var(--amber); color: #e8dcff; }
  .sf-hs-box h2 { margin: 0; font: 400 1.25rem/1 'Bungee', sans-serif; letter-spacing: 0.04em; color: var(--amber); }
  .sf-hs-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.35rem; }
  .sf-hs-steps li { display: flex; align-items: center; gap: 0.6rem; font-size: 1.3rem; line-height: 1.05; font-weight: 600; letter-spacing: 0.07em; }
  .sf-hs-steps i { flex: 0 0 1.7rem; height: 1.7rem; display: flex; align-items: center; justify-content: center; font: 400 0.95rem/1 'Bungee', sans-serif; border: 2px solid var(--amber); color: var(--amber); }
  .sf-hs-steps b { color: var(--cyan); font-weight: 600; }
  .sf-hs-steps svg { vertical-align: -0.12em; color: var(--cyan); }
  .sf-hs-note { margin: 0; font-size: 1.05rem; line-height: 1.1; letter-spacing: 0.07em; color: #b9a8dc; }
  .sf-hs-note.sf-hs-warn { color: var(--amber); }
  .sf-hs-close { appearance: none; align-self: flex-end; min-width: 8rem; min-height: 2.75rem; padding: 0 1rem; cursor: pointer; touch-action: manipulation;
    font: 400 1rem/1 'Bungee', sans-serif; letter-spacing: 0.06em; color: #12041f; background: var(--amber); border: 2px solid var(--amber); border-radius: 0; }
  @media (orientation: landscape) and (max-height: 22rem) {
    .sf-hs-box { width: min(46rem, 100%); }
    .sf-hs-foot { display: flex; align-items: center; gap: 0.75rem; }
    .sf-hs-foot .sf-hs-notes { flex: 1; }
  }
  .sf-hs-notes { display: flex; flex-direction: column; gap: 0.2rem; }`;
  document.head.appendChild(s);
}

/** open the Add to Home Screen how-to */
export function openHomescreenHelp() {
  if (!homescreenHelp || panel) return;
  style();
  markSeen();
  // the home-screen app keeps its own storage and opens at the title: a room joined in this tab doesn't follow
  const q = new URLSearchParams(location.search);
  const inRoom = q.has('room') || q.has('crew') || document.documentElement.classList.contains('online');
  panel = document.createElement('div');
  panel.className = 'sf-hs';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Play full screen');
  panel.innerHTML = `
    <div class="sf-hs-box">
      <h2>PLAY FULL SCREEN</h2>
      <ol class="sf-hs-steps">
        <li><i>1</i><span>TAP <b>SHARE</b> ${SHARE} IN SAFARI'S BAR (IT CAN BE UNDER <b>&#8226;&#8226;&#8226;</b>)</span></li>
        <li><i>2</i><span>CHOOSE <b>ADD TO HOME SCREEN</b>, THEN <b>ADD</b></span></li>
        <li><i>3</i><span>OPEN <b>STICK FIGHT</b> FROM YOUR HOME SCREEN</span></li>
      </ol>
      <div class="sf-hs-foot">
        <div class="sf-hs-notes">
          <p class="sf-hs-note">NO SAFARI BARS, THE WHOLE SCREEN, AND IT WORKS OFFLINE.</p>
          ${inRoom ? '<p class="sf-hs-note sf-hs-warn">IN A ROOM? PLAY THIS ONE HERE FIRST: THE APP OPENS AT THE TITLE.</p>' : ''}
        </div>
        <button type="button" class="sf-hs-close">GOT IT</button>
      </div>
    </div>`;
  const close = () => { if (panel) { panel.remove(); panel = null; } window.removeEventListener('keydown', key, true); };
  const key = (/** @type {KeyboardEvent} */ e) => { if (e.code === 'Escape' || e.code === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  // a tap on the dim closes it too; nothing under the how-to gets the tap
  panel.addEventListener('click', (e) => { e.stopPropagation(); const t = /** @type {Element} */ (e.target); if (t === panel || t.closest('.sf-hs-close')) close(); });
  for (const type of ['touchstart', 'touchend', 'pointerdown', 'mousedown']) panel.addEventListener(type, (e) => e.stopPropagation());
  window.addEventListener('keydown', key, true);
  document.body.appendChild(panel);
}

// Sideways, the callout goes in the gutter left of the stage and needs 4.5rem of it clear of the notch.
function place() {
  if (!tip) return;
  const de = document.documentElement, stage = document.getElementById('stage');
  const rem = parseFloat(getComputedStyle(de).fontSize) || 16;
  if (de.clientHeight >= de.clientWidth || !stage) { tip.classList.add('sf-hs-fits'); tip.style.removeProperty('--hs-w'); return; }
  const left = parseFloat(getComputedStyle(tip).left) || 0;
  const room = stage.getBoundingClientRect().left - left - 0.375 * rem;
  tip.classList.toggle('sf-hs-fits', room >= 4.5 * rem);
  tip.style.setProperty('--hs-w', `${Math.floor(Math.min(room, 7 * rem))}px`);
}

if (homescreenHelp && typeof window !== 'undefined') {
  window.addEventListener('sf:homescreen', openHomescreenHelp);
  if (!seen()) {
    style();
    tip = document.createElement('div');
    tip.className = 'sf-hs-tip';
    tip.innerHTML = '<button type="button" class="sf-hs-go" aria-label="Play full screen: how to add the game to your home screen"><b>PLAY FULL SCREEN</b><span>SHOW ME HOW</span></button><button type="button" class="sf-hs-x" aria-label="Dismiss">X</button>';
    tip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (/** @type {Element} */ (e.target).closest('.sf-hs-x')) markSeen(); else openHomescreenHelp();
    });
    for (const type of ['touchstart', 'touchend', 'pointerdown', 'mousedown']) tip.addEventListener(type, (e) => e.stopPropagation());
    const mount = () => {
      document.body.appendChild(tip); place();
      window.addEventListener('resize', place);
      window.addEventListener('orientationchange', () => setTimeout(place, 350));   // iOS reports the new size late
      if (window.visualViewport) window.visualViewport.addEventListener('resize', place);
    };
    if (document.body) mount(); else window.addEventListener('DOMContentLoaded', mount);
  }
}
