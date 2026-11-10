// The site's script (README, "Site"): every page around the game loads it. It sends the page's visit, runs
// the install hint and the row under the homepage's embedded game (FULL SCREEN), and on a fighter page
// loads site/rigs.js for the live move animations. A page with a [data-stats] section (the homepage, a
// fighter page) loads site/stats.js for the numbers. On the homepage it also fills the LIVE NOW strip. The
// roster cards' idle loops are CSS sprites (no script).
import '../src/analytics.js';
import { install } from '../src/install.js';

if (document.querySelector('canvas[data-mode]')) import('./rigs.js');
if (document.querySelector('[data-stats]')) import('./stats.js');   // the books: pick rates, win rates, the matchup chart

// ---- install: the browser's own prompt where there is one, the how-to on an iPhone ---------------------------
const box = document.querySelector('[data-install]');
if (box) {
  const btn = box.querySelector('[data-install-button]'), text = box.querySelector('[data-install-text]');
  const paint = () => {
    if (install.standalone) { box.hidden = true; return; }
    const k = install.kind;
    btn.hidden = k !== 'prompt';
    if (k === 'prompt') text.innerHTML = '<b>INSTALL IT</b> and it opens full screen, like a native game.';
    else if (k === 'ios') text.innerHTML = '<b>INSTALL IT:</b> tap Share, then Add to Home Screen. It opens full screen, like a native game.';
  };
  btn.addEventListener('click', () => install.prompt());
  install.onChange(paint);
  paint();
}

// ---- the homepage's embedded game: just the game's own page in a frame ----------------------------------------
// A click into the frame focuses it (keys go to the game) and is the gesture that turns its sound on, so the
// frame needs nothing on top of it. FULL SCREEN puts the frame itself full screen; iPhone Safari has no
// element fullscreen, so there (or if the browser says no) it opens the game's own page instead.
const game = document.querySelector('[data-frame] iframe');
const fsBtn = document.querySelector('[data-fullscreen]');
if (game && fsBtn) {
  const req = game.requestFullscreen || game.webkitRequestFullscreen;
  const ownPage = () => { location.href = './play/'; };
  const focusGame = () => { try { game.focus(); game.contentWindow.focus(); } catch { /* not loaded yet */ } };
  fsBtn.addEventListener('click', () => {
    if (!req) return ownPage();
    let p;
    try { p = req.call(game, { navigationUI: 'hide' }); } catch { return ownPage(); }
    focusGame();
    Promise.resolve(p).then(() => {
      focusGame();
      try { screen.orientation.lock('landscape').catch(() => {}); } catch { /* no orientation lock */ }
    }, ownPage);
  });
}

// ---- LIVE NOW: quick online matches anyone can watch (README, Multiplayer, Spectators) -------------------------
// GET api/live lists them (the Worker caches it for a few seconds). The strip only shows while something is on, and
// each card opens the game on that match: play/?watch=CODE. Asked again every 30 seconds while the page is in view;
// the roster (for the fighters' names and colors) loads only once there's a match to show.
const liveBox = document.querySelector('[data-live]'), liveList = document.querySelector('[data-live-list]');
if (liveBox && liveList) {
  const CODE = /^[A-Z0-9]{4}$/;
  let chars = null, shown = '';
  const esc = (s) => String(s).replace(/[^A-Z0-9 ]/gi, '');
  async function paint(rows) {
    const key = JSON.stringify(rows);
    if (key === shown) return;
    shown = key;
    liveBox.hidden = !rows.length;
    if (!rows.length) { liveList.textContent = ''; return; }
    if (!chars) { try { chars = await import('../src/characters/index.js'); } catch { chars = { characterOr: (id) => ({ name: String(id).toUpperCase(), color: '#fff' }) }; } }
    liveList.textContent = '';
    for (const r of rows.slice(0, 6)) {
      const a = document.createElement('a');
      a.className = 's-live-card'; a.href = `./play/?watch=${r.code}`;
      const side = (i) => {
        const c = chars.characterOr(r.chars[i]), mirror = i === 1 && r.chars[0] === r.chars[1];
        const s = document.createElement('span'); s.className = 's-live-side';
        const f = document.createElement('b'); f.textContent = c.name; f.style.color = (mirror && c.alt) || c.color;
        const n = document.createElement('i'); n.textContent = esc(r.names[i]) || `P${i + 1}`;
        s.append(f, n);
        return s;
      };
      const score = document.createElement('em'); score.textContent = `${r.wins[0] | 0} – ${r.wins[1] | 0}`;
      const meta = document.createElement('small'); meta.textContent = `ROUND ${r.round | 0}  ·  ${r.watching | 0} WATCHING`;
      const go = document.createElement('span'); go.className = 's-live-go'; go.textContent = 'WATCH';
      a.append(side(0), score, side(1), meta, go);
      liveList.appendChild(a);
    }
  }
  async function poll() {
    if (document.hidden) return;
    try {
      const res = await fetch('./api/live', { signal: AbortSignal.timeout(4000) });
      const body = res.ok ? await res.json() : { live: [] };
      paint((Array.isArray(body.live) ? body.live : []).filter((r) => r && CODE.test(r.code) && Array.isArray(r.chars) && Array.isArray(r.names) && Array.isArray(r.wins)));
    } catch { /* offline, or no Worker behind the dev server: the strip stays as it is */ }
  }
  poll();
  setInterval(poll, 30000);
  document.addEventListener('visibilitychange', poll);
}
