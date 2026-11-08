// The seam between the menus (src/flow/) and online play (src/net/online.js, owned by the
// networking side). The flow only ever talks to the object behind getNet(). main.js plugs the real
// module in with setNet(adaptOnline(online)); before that (or if it failed to load) the stub below
// answers that online play isn't available, and the menus say so.
//
// What the flow expects, in order:
//   host:  net.host() -> { code, link }   the flow shows the code and the link, "waiting for a friend"
//   guest: net.join(code)                 resolves once the room is being opened (a failure later comes as 'error')
//   'status' updates the waiting line; 'error' (bad code, full room, host gone) ends it with that message
//   'connected' fires when both players are in and the match starts: the flow hides its menus and shows
//          the touch controls, and calls net.startMatch() (a no-op for online.js, which starts it itself)
//   during the match the flow calls net.step(ms) every frame in place of the local sim step, if
//   net.step exists (online.js has none: main.js steps it through online.advance)
//   'peer-left' ends the match on our side too; 'desync' doesn't (online.js shows it in its readout)
//   net.leave() at any point (CANCEL, BACK, QUIT) closes the room and hands the sim back

/**
 * The events the flow listens for.
 * @typedef {{
 *   connected: { role: 'host' | 'guest', code: string },
 *   status: { state: string, detail: string, text: string },
 *   'peer-left': { reason?: string },
 *   desync: { frame: number },
 *   error: { message: string },
 * }} NetEvents
 */
/**
 * What the flow calls. online.js is wrapped to this by adaptOnline below.
 * @typedef {object} NetApi
 * @property {boolean} available   false: the menus show "online play isn't ready" instead of trying
 * @property {number} CODE_LEN      room codes: CODE_LEN characters from ALPHABET (no 0/O, 1/I/L)
 * @property {string} ALPHABET
 * @property {() => Promise<{ code: string, link: string }>} host   open a room; resolves with its code and a ?room=CODE link
 * @property {(code: string) => Promise<void>} join                 join a friend's room
 * @property {() => void} startMatch                                both connected: start the match (online.js already has)
 * @property {(ms: number) => void} [step]                          optional: steps the online match in place of the local sim
 * @property {() => void} leave                                     close the room / match and hand the sim back
 * @property {(id: string) => void} [setCharacter]                  this side's fighter, picked on the select screen before HOST or JOIN
 * @property {<K extends keyof NetEvents>(ev: K, fn: (e: NetEvents[K]) => void) => () => void} on   subscribe; returns an unsubscribe
 */

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // matches worker/index.ts
export const CODE_LEN = 4;

/** a normalized code (upper case, only legal characters), or '' */
export function cleanCode(s) {
  const up = String(s || '').toUpperCase();
  let out = '';
  for (const ch of up) if (CODE_ALPHABET.includes(ch)) out += ch;
  return out.slice(0, CODE_LEN);
}
export function roomLink(code) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

const NOT_READY = 'ONLINE PLAY IS NOT READY YET';
function createStub() {
  return {
    available: false,
    CODE_LEN, ALPHABET: CODE_ALPHABET,
    host: () => Promise.reject(new Error(NOT_READY)),
    join: () => Promise.reject(new Error(NOT_READY)),
    startMatch() {},
    leave() {},
    on: () => () => {},
  };
}

// ---- the real module (src/net/online.js) -------------------------------------------------------
// Its host() resolves { code, url }; join(code) resolves once the room's socket is opening, and a
// failure afterwards (no such room, full, unreachable, version) arrives as status 'error' with a
// detail, or 'host-gone'. Its 'connected' fires as the match begins (it calls main.js startMatch
// itself), so startMatch() here has nothing left to do, and main.js already steps the match through
// online.advance, so there's no step(). How a match ends reaches the flow through main.js's
// endMatch hook (flow.netEnded), not through here.
const STATUS_TEXT = {
  creating: 'OPENING A ROOM', waiting: 'WAITING FOR A FRIEND', joining: 'FINDING THE ROOM', linking: 'CONNECTING',
};
const ERROR_TEXT = {
  'no-room': 'NO ROOM WITH THAT CODE', full: 'THAT ROOM IS FULL', 'bad-code': 'CODES ARE 4 LETTERS', unreachable: "CAN'T REACH THE ROOM SERVER",
  lost: 'CONNECTION LOST', version: 'YOUR GAMES DIFFER: RELOAD BOTH', closed: 'THE ROOM CLOSED',
  busy: 'SERVER BUSY: TRY AGAIN SHORTLY', flood: 'TOO MUCH TRAFFIC: ROOM CLOSED',   // worker rate limits
};
export function adaptOnline(online) {
  const handlers = {};
  const emit = (ev, e) => { for (const f of handlers[ev] || []) f(e); };
  online.on('status', (st, detail) => {
    if (st === 'error') emit('error', { message: ERROR_TEXT[detail] || 'SOMETHING WENT WRONG' });
    else if (st === 'host-gone') emit('error', { message: 'THE HOST LEFT THE ROOM' });
    else emit('status', { state: st, detail, text: STATUS_TEXT[st] || '' });
  });
  online.on('connected', (e) => emit('connected', { role: e && e.role, code: e && e.code }));
  online.on('peer-left', () => emit('peer-left', {}));
  online.on('desync', (d) => emit('desync', { frame: d && d.frame }));
  return {
    available: true,
    CODE_LEN, ALPHABET: CODE_ALPHABET,
    host: () => online.host().then((r) => ({ code: r.code, link: r.url || roomLink(r.code) })),
    join: (code) => online.join(code).then(() => undefined),
    startMatch() { /* online.js already started it when it fired 'connected' */ },
    leave: () => online.leave(),
    setCharacter: (id) => online.setCharacter(id),
    on(ev, fn) {
      const list = (handlers[ev] = handlers[ev] || []);
      list.push(fn);
      return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    },
  };
}

let current = createStub();
export function getNet() { return current; }
/** the networking module (or a test) plugs itself in here */
export function setNet(impl) { current = impl; }
