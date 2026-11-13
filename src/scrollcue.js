// Scroll cues: every box that scrolls (a data-scroll="y" box, the ones touch.js lets a finger move) shows when there's
// more of it. With more below, its bottom edge fades out (sc-more); scrolled down, its top edge fades too (sc-less).
// So a list cut off at the bottom of a phone reads as "keep going", never as the end of the page. SETTINGS adds a
// ▼ MORE chip on top of the fade (src/audio/ui.js), and scripts/menus.mjs --check fails any box hiding rows with no cue.
//
// One watcher for the whole page: a scroll anywhere (captured), a resize of a box, and any change to the DOM (a screen
// built, a tab shown, a list filled) repaint the cues, at most every 120 ms for DOM changes.

const SEL = '[data-scroll="y"]';

/** set a box's cue classes from where it's scrolled to */
export function paintCue(b) {
  if (!(b instanceof HTMLElement)) return;
  const room = b.scrollHeight - b.clientHeight;
  b.classList.toggle('sc-more', room > 2 && b.scrollTop < room - 2);
  b.classList.toggle('sc-less', room > 2 && b.scrollTop > 2);
}

let watching = false;
export function watchScrollCues() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  const s = document.createElement('style');
  s.id = 'scroll-cue-style';
  // a fade, not a bar: it works on every box's own background
  s.textContent = `
  ${SEL}.sc-more { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), rgba(0,0,0,0.08)); mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), rgba(0,0,0,0.08)); }
  ${SEL}.sc-less { -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.08), #000 28px); mask-image: linear-gradient(to bottom, rgba(0,0,0,0.08), #000 28px); }
  ${SEL}.sc-more.sc-less { -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.08), #000 28px, #000 calc(100% - 44px), rgba(0,0,0,0.08)); mask-image: linear-gradient(to bottom, rgba(0,0,0,0.08), #000 28px, #000 calc(100% - 44px), rgba(0,0,0,0.08)); }`;
  document.head.appendChild(s);

  const seen = new WeakSet();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => es.forEach((e) => paintCue(e.target))) : null;
  const scan = () => {
    for (const b of document.querySelectorAll(SEL)) {
      if (ro && !seen.has(b)) { seen.add(b); ro.observe(b); }
      paintCue(b);
    }
  };
  document.addEventListener('scroll', (e) => { const t = e.target; if (t instanceof Element && t.matches(SEL)) paintCue(t); }, { capture: true, passive: true });
  let timer = 0;
  const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; scan(); }, 120); };
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-scroll', 'class', 'style'] });
  window.addEventListener('resize', soon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(soon).catch(() => {});
  scan();
}
