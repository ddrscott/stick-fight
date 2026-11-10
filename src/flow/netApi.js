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
//   between matches (the room session; see online.js): 'match-over' fires when a match ends on both
//   machines (the flow shows its post-match screen), 'session' whenever anything between matches
//   changes (the rival's choice or pick, a countdown, the tally); view() is the same picture on
//   demand, and postChoose / postBack / postPoke / postFocus / pick / startNow are the buttons

/**
 * The events the flow listens for.
 * @typedef {{
 *   connected: { role: 'host' | 'guest', code: string },
 *   status: { state: string, detail: string, text: string },
 *   'peer-left': { reason?: string },
 *   desync: { frame: number },
 *   error: { message: string },
 *   'match-over': any,
 *   session: any,
 * }} NetEvents
 */
/**
 * What the flow calls. online.js is wrapped to this by adaptOnline below.
 * @typedef {object} NetApi
 * @property {boolean} available   false: the menus show "online play isn't ready" instead of trying
 * @property {number} CODE_LEN      room codes: CODE_LEN characters from ALPHABET (no 0/O, 1/I/L)
 * @property {string} ALPHABET
 * @property {(opts?: { code?: string, pickFirst?: boolean, crew?: boolean }) => Promise<{ code: string, link: string }>} host   open a room (or host one a crew claimed: opts.code); resolves with its code and a ?room=CODE link
 * @property {(code: string, opts?: { pickFirst?: boolean, crew?: boolean }) => Promise<void>} join   join a friend's room (pickFirst: open on the pick screen, as every flow room does)
 * @property {(name: string) => void} [setName]                    this player's display name, shown to the rival
 * @property {() => void} startMatch                                both connected: start the match (online.js already has)
 * @property {(ms: number) => void} [step]                          optional: steps the online match in place of the local sim
 * @property {() => void} leave                                     close the room / match and hand the sim back
 * @property {(id: string) => void} [setCharacter]                  this side's fighter: where its cursor starts on the pick screen (and its fighter if it never picks)
 * @property {() => any} [view]                                     between matches: the session as this side sees it (online.js view())
 * @property {(c: 'rematch' | 'chars') => void} [postChoose]       a post-match button: the guest's is a request, the host's decides
 * @property {() => void} [postBack]                                back on the post-match screen: guest asks to wait, host stops the countdown
 * @property {() => void} [postPoke]                                any other press there: stops the auto rematch
 * @property {(c: string) => void} [postFocus]                      where this side's cursor is
 * @property {(id: string, ready: boolean) => void} [pick]          the pick screen: this side's card and whether it's locked in
 * @property {() => void} [startNow]                                the host's START on the pick screen
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
  online.on('match-over', (v) => emit('match-over', v));
  online.on('session', (v) => emit('session', v));
  return {
    available: true,
    CODE_LEN, ALPHABET: CODE_ALPHABET,
    host: (opts) => online.host(opts).then((r) => ({ code: r.code, link: r.url || roomLink(r.code) })),
    join: (code, opts) => online.join(code, opts).then(() => undefined),
    setName: (name) => online.setName(name),
    startMatch() { /* online.js already started it when it fired 'connected' */ },
    leave: () => online.leave(),
    setCharacter: (id) => online.setCharacter(id),
    view: () => online.view(),
    postChoose: (c) => online.postChoose(c),
    postBack: () => online.postBack(),
    postPoke: () => online.postPoke(),
    postFocus: (c) => online.postFocus(c),
    pick: (id, ready) => online.pick(id, ready),
    startNow: () => online.startNow(),
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
