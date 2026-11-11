// Crew and room links (README, Site, Old links; Multiplayer, Crew rooms). A crew's permanent link is
// <root>crew/<slug> and a quick room's <root>room/<CODE>: the Worker answers both with the game page and the
// room's share tags (worker/og.ts), and 301s the old play/?crew= and ?room= forms to them. The game reads
// the room from the path first and the query second (the dev server and a page opened before the Worker's
// redirect still carry ?crew=), and puts the address back to play/ when the player leaves the room.
import { ROOT } from './root.js';

/** the game page's address: <root>play/ */
export const gameUrl = () => new URL('play/', ROOT);

/** the clean link for a crew or a room, e.g. https://askscottpierce.com/stick-fight/crew/lunch-crew-7k2qm */
export const linkUrl = (kind, id) => new URL(`${kind}/${encodeURIComponent(id)}`, ROOT);

const PATH = /\/(crew|room)\/([^/?#]+)\/?$/;

/** the crew slug or room code this page was opened with, raw: from the path, else from the query */
export function linkFromUrl(kind, loc = typeof location !== 'undefined' ? location : null) {
  if (!loc) return '';
  const m = PATH.exec(loc.pathname);
  if (m && m[1] === kind) { try { return decodeURIComponent(m[2]); } catch { return m[2]; } }
  return new URLSearchParams(loc.search).get(kind) || '';
}

/** the address bar for a room: its clean link (id) or play/ (no id), keeping any other query and the hash */
export function setLinkInBar(kind, id) {
  try {
    const here = new URL(location.href);
    const onLink = PATH.exec(here.pathname);
    here.searchParams.delete(kind);
    const to = id ? linkUrl(kind, id) : onLink && onLink[1] === kind ? gameUrl() : new URL(here.pathname, here);
    to.search = here.search; to.hash = here.hash;
    if (to.href !== location.href) history.replaceState(history.state, '', to.href);
  } catch { /* sandboxed */ }
}
