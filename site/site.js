// The site's script (README, "Site"): every page around the game loads it. It sends the page's visit, runs
// the install hint and the row under the homepage's embedded game (FULL SCREEN), and on a fighter page
// loads site/rigs.js for the live move animations. The roster cards' idle loops are CSS sprites (no script).
import '../src/analytics.js';
import { install } from '../src/install.js';

if (document.querySelector('canvas[data-mode]')) import('./rigs.js');

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
