// Online play: the session API, the in-match connection readout, and an optional lobby panel.
// The game's menus (src/flow/) own the screens; this module owns the network. main.js makes
// three calls: createOnline(...) once, online.advance(ms) instead of sim.step while a match is
// on, and online.onKey(code) to swallow hotkeys (pause, reset, horde) that would break a match.
//
//   const net = createOnline({ sim, input, startMatch, endMatch })
//   await net.host()            -> { code, url }   a new room; resolves once the room is open
//   await net.join(code)        -> { code }        resolves when connected to the room
//   net.on('status' | 'connected' | 'peer-left' | 'start' | 'end' | 'desync', fn)
//   net.leave()                 hang up and end the match (endMatch is called)
//   net.roomFromUrl()           the ?room=CODE on the page's URL, or ''
//   net.openLobby(mode?)        the built-in panel: 'menu' | 'host' | 'join' (+ code)
//   net.active                  a match is running (main.js steps it through net.advance)
//
// Once both players are linked (peer to peer, or the relay after RTC_TIMEOUT_MS), the host
// picks a seed and sends {t:'start'}; both call startMatch({ seed, localIndex, lockstep }),
// which main.js turns into the 'online' scene: unit 0 is the host, unit 1 the guest, each
// unit's controller reads the netcode's input for the frame. (The key is still `lockstep` for
// main.js; the netcode is rollback now, src/net/rollback.js.) Rematches follow on their own:
// the sim reseeds from the match seed after the WINS card, the same way on both machines.
//
// Testing: ?netsim=LATENCY,JITTER,LOSS delays everything this side sends by LATENCY ms (one way),
// give or take up to JITTER ms, and drops LOSS percent of game packets (control messages ride the
// reliable socket and are only delayed). Set it on both pages: ?netsim=30,5,2 on each is about
// 60 ms of round trip with 2% loss. ?relay=1 forces the relay.

import { createLink, createRoom } from './link.js';
import { createRollback } from './rollback.js';
import { hashSim } from './hash.js';

export const NET_VERSION = 4;   // bump when the sim or the netcode changes in a way old builds can't play against (2: rollback, 3: stamina faint and combo decay, 4: side keeping and knockback away from the attacker)
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const STORE = 'stick-fight-net';   // localStorage: { relay: true } forces the relay (testing)

/**
 * @param {{ sim: any, input: any, startMatch: (o: { seed: number, localIndex: number, lockstep: any }) => void,
 *           endMatch: (reason: string) => void, stage?: HTMLElement | null }} game
 */
export function createOnline(game) {
  /** @type {Record<string, Function[]>} */
  const handlers = {};
  const emit = (ev, ...a) => { for (const f of handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } };
  /** @type {any} */ let link = null;
  /** @type {any} */ let lockstep = null;
  let localReady = false, remoteReady = false, state = 'idle', detail = '', code = '', role = '';
  /** @type {null | ((frame: number) => any)} */ let localSource = null;
  const params = new URLSearchParams(location.search);
  const forceRelay = () => params.get('relay') === '1' || net.forceRelay || (() => { try { return !!JSON.parse(localStorage.getItem(STORE) || '{}').relay; } catch { return false; } })();

  function setState(s, d = '') { state = s; detail = d; emit('status', s, d); lobby.render(); }

  function shareUrl(c) {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('room', c);
    return u.toString();
  }

  function wire(l) {
    link = l;
    l.on('peer', (present) => {
      if (present) { localReady = false; remoteReady = false; setState('linking'); return; }
      if (lockstep) finish('peer-left');
      else if (state !== 'idle') setState(role === 'host' ? 'waiting' : 'host-gone');
    });
    l.on('status', () => {
      lobby.render();
      if (l.ready && !localReady && !lockstep) { localReady = true; l.sendControl({ t: 'ready', v: NET_VERSION }); maybeStart(); }
    });
    l.on('control', (msg) => {
      if (lockstep && lockstep.onControl(msg)) return;
      if (msg.t === 'ready') {
        if (msg.v !== NET_VERSION) { setState('error', 'version'); l.close(); return; }
        remoteReady = true; maybeStart();
      } else if (msg.t === 'start' && role === 'guest' && !lockstep) begin(msg.seed >>> 0);
    });
    l.on('packet', (buf) => { if (lockstep) lockstep.onPacket(buf); });
    l.on('closed', (reason) => {
      if (lockstep) finish(reason === 'closed' ? 'peer-left' : 'lost');
      else if (state !== 'idle') setState('error', reason);
      link = null;
    });
  }

  function maybeStart() {
    if (role !== 'host' || !localReady || !remoteReady || lockstep) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    link.sendControl({ t: 'start', seed });
    begin(seed);
  }

  function begin(seed) {
    const localIndex = role === 'host' ? 0 : 1;
    lockstep = createRollback({
      sim: game.sim, localIndex, link: netsimLink(link, params.get('netsim')),
      sampleLocal: (f) => (localSource ? localSource(f) : game.input.snapshot()),
      onDesync: (d) => { emit('desync', d); readout.render(); },
    });
    lobby.close();
    setState('playing');
    try { game.input.swallowHeld(); } catch { /* old input */ }
    document.documentElement.classList.add('online');
    emit('connected', { mode: link.mode, role, code });
    game.startMatch({ seed, localIndex, lockstep });
    emit('start', { seed, localIndex });
    readout.show(true);
  }

  function finish(reason) {
    const was = !!lockstep;
    lockstep = null;
    if (link) { const l = link; link = null; l.close(); }
    document.documentElement.classList.remove('online');
    readout.show(false);
    clearRoomParam();
    if (reason === 'peer-left') emit('peer-left');
    setState('idle');
    if (was) { game.endMatch(reason); emit('end', reason); if (reason !== 'left') lobby.message(reason === 'lost' ? 'CONNECTION LOST' : 'YOUR RIVAL LEFT'); }
  }
  function clearRoomParam() {
    if (!params.has('room')) return;
    params.delete('room');
    const u = new URL(location.href); u.searchParams.delete('room');
    try { history.replaceState(null, '', u.toString()); } catch { /* sandboxed */ }
  }

  const net = {
    forceRelay: false,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return net; },
    /** a new room as host: resolves once the room's socket is open */
    async host() {
      net.leave();
      role = 'host'; setState('creating');
      try { code = await createRoom(); } catch (e) { setState('error', (e && e.reason) || 'unreachable'); throw e; }
      wire(createLink({ code, role: 'host', forceRelay: forceRelay() }));
      setState('waiting');
      return { code, url: shareUrl(code), link };
    },
    /** join a room by its code */
    async join(c) {
      net.leave();
      c = String(c || '').trim().toUpperCase();
      if (!CODE_RE.test(c)) { setState('error', 'bad-code'); throw new Error('bad room code'); }
      role = 'guest'; code = c;
      wire(createLink({ code, role: 'guest', forceRelay: forceRelay() }));
      setState('joining');
      return { code, link };
    },
    leave() { if (lockstep || link) finish('left'); else if (state !== 'idle') setState('idle'); },
    roomFromUrl() { const r = (params.get('room') || '').toUpperCase(); return CODE_RE.test(r) ? r : ''; },
    /** while a match runs, main.js steps the sim here (ms already scaled for slow motion) */
    advance(ms) {
      if (!lockstep) return 0;
      const n = lockstep.advance(ms);
      if (lockstep && lockstep.lost) finish('lost');
      readout.tick();
      return n;
    },
    /** hotkeys during a match: true = swallowed. Escape (or pad Select / touch LEAVE) asks to leave. */
    onKey(c) {
      if (!lockstep) return false;
      if (c === 'Escape' || c === 'KeyR') { lobby.confirmLeave(); return true; }
      return c !== 'KeyH' && c !== 'F1' && c !== 'Slash';   // hitboxes and the move list are local; nothing else runs
    },
    openLobby(mode = 'menu', c = '') { lobby.open(mode, c); },
    closeLobby() { lobby.close(); },
    /** the lobby panel is up (or just closed): the attract screen shouldn't start a game */
    get busy() { return lobby.busy; },
    get active() { return !!lockstep; },
    get state() { return state; },
    get statusDetail() { return detail; },
    get role() { return role; },
    get code() { return code; },
    get link() { return link; },
    get lockstep() { return lockstep; },   // the netcode (rollback); the old name stays for callers
    get netcode() { return lockstep; },
    shareUrl,
    stats() {
      const s = lockstep ? lockstep.stats() : null;
      return { state, role, code, mode: link ? link.mode : '', ...(s || {}) };
    },
    // tests: scripted local input, a common stop frame, and the state hash
    setLocalSource(fn) { localSource = fn; },
    haltAt(f) { if (lockstep) lockstep.haltAt = f; },
    hash() { return { frame: lockstep ? lockstep.frame : -1, hash: hashSim(game.sim) }; },
  };

  const readout = createReadout(net, game.stage || document.getElementById('stage'));
  const lobby = createLobby(net, game);
  /** @type {any} */ (window).__net = net;
  return net;
}

// ---- ?netsim=LATENCY,JITTER,LOSS: a bad network on purpose (tests) -----------------------------
// Wraps the link the netcode sends through. Packets and control messages go out LATENCY ms late
// (one way), give or take JITTER ms (so packets can arrive out of order, as they do over the
// unordered DataChannel); LOSS percent of packets never go out. Without the option, the link as is.
function netsimLink(link, spec) {
  if (!spec) return link;
  const [lat = 0, jit = 0, loss = 0] = String(spec).split(',').map((v) => Math.max(0, +v || 0));
  if (!lat && !jit && !loss) return link;
  console.info(`[net] netsim: +${lat} ms one way, ±${jit} ms jitter, ${loss}% packet loss`);
  const later = (fn) => setTimeout(fn, Math.max(0, lat + (Math.random() * 2 - 1) * jit));
  return {
    sendPacket(buf) { if (Math.random() * 100 < loss) return; later(() => link.sendPacket(buf)); },
    sendControl(msg) { later(() => link.sendControl(msg)); },
  };
}

// ---- the connection readout: bottom-left corner during a match --------------------------------
function createReadout(net, stage) {
  injectStyle();
  const el = document.createElement('div');
  el.className = 'nf-readout';
  el.hidden = true;
  el.innerHTML = '<span class="nf-mode"></span> <span class="nf-ping"></span><b class="nf-desync" hidden>DESYNC</b><b class="nf-wait" hidden>WAITING FOR RIVAL</b>';
  (stage || document.body).appendChild(el);
  const mode = el.querySelector('.nf-mode'), ping = el.querySelector('.nf-ping');
  const desync = /** @type {HTMLElement} */ (el.querySelector('.nf-desync')), wait = /** @type {HTMLElement} */ (el.querySelector('.nf-wait'));
  let last = 0;
  const r = {
    show(on) { el.hidden = !on; if (on) r.render(); },
    tick() { const t = performance.now(); if (t - last > 250) { last = t; r.render(); } },
    render() {
      const s = net.stats();
      if (!mode || !ping) return;
      mode.textContent = s.mode === 'p2p' ? 'P2P' : s.mode === 'relay' ? 'RELAY' : '...';
      el.classList.toggle('nf-relay', s.mode === 'relay');
      // the round trip, how many frames the last correction re-ran, and the input delay
      ping.textContent = `${Math.round(s.rtt || 0)} MS · RB ${s.lastDepth || 0} · DELAY ${s.delay || 0}`;
      desync.hidden = !s.desync;
      wait.hidden = !(s.stalledMs > 300);
    },
  };
  return r;
}

// ---- the lobby panel (optional: the flow's menus can drive net.host/join instead) -----------
function createLobby(net, game) {
  const root = document.createElement('div');
  root.className = 'nf-lobby';
  root.hidden = true;
  document.body.appendChild(root);
  let mode = 'closed', closedAt = -1e9, msg = '', joinCode = '', padPrev = [], padRaf = 0;

  const STATUS = {
    creating: 'OPENING A ROOM…', waiting: 'WAITING FOR A RIVAL…', joining: 'FINDING THE ROOM…', linking: 'CONNECTING…',
    'host-gone': 'THE HOST LEFT THE ROOM',
  };
  const ERRORS = { 'no-room': 'NO ROOM WITH THAT CODE', full: 'THAT ROOM IS FULL', 'bad-code': 'CODES ARE 4 LETTERS', unreachable: 'CAN\'T REACH THE ROOM SERVER', lost: 'CONNECTION LOST', version: 'YOUR GAMES DIFFER: RELOAD BOTH', closed: 'THE ROOM CLOSED', busy: 'SERVER BUSY: TRY AGAIN SHORTLY', flood: 'TOO MUCH TRAFFIC: ROOM CLOSED' };

  function html() {
    const s = net.state;
    if (mode === 'message') return `<h2>${msg}</h2><div class="nf-row"><button data-act="close" class="nf-btn">OK</button></div>`;
    if (mode === 'leave') return `<h2>LEAVE THE MATCH?</h2><div class="nf-row"><button data-act="leave" class="nf-btn nf-pink">LEAVE</button><button data-act="stay" class="nf-btn">STAY</button></div>`;
    if (mode === 'menu') return `<h2>PLAY ONLINE</h2><div class="nf-col"><button data-act="host" class="nf-btn">HOST A ROOM</button><button data-act="join" class="nf-btn">JOIN A ROOM</button><button data-act="close" class="nf-btn nf-dim">BACK</button></div>`;
    if (s === 'error') {
      return `<h2>${ERRORS[net.statusDetail] || 'SOMETHING WENT WRONG'}</h2><div class="nf-row"><button data-act="menu" class="nf-btn">BACK</button></div>`;
    }
    if (mode === 'join' && (s === 'idle')) {
      return `<h2>JOIN A ROOM</h2><input class="nf-code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" value="${joinCode}" aria-label="Room code"><div class="nf-row"><button data-act="go" class="nf-btn">JOIN</button><button data-act="menu" class="nf-btn nf-dim">BACK</button></div>`;
    }
    const link = net.link;
    const how = link && link.mode !== 'connecting' ? (link.mode === 'p2p' ? 'DIRECT LINK' : 'RELAYED LINK') : '';
    const status = `<p class="nf-status">${STATUS[s] || ''}${how ? ' ' + how : ''}</p>`;
    if (net.role === 'host' && net.code) {
      const share = typeof navigator.share === 'function' ? '<button data-act="share" class="nf-btn">SHARE</button>' : '';
      return `<h2>YOUR ROOM</h2><div class="nf-roomcode">${net.code}</div><p class="nf-link">${net.shareUrl(net.code)}</p>${status}<div class="nf-row">${share}<button data-act="copy" class="nf-btn">COPY LINK</button><button data-act="cancel" class="nf-btn nf-dim">CANCEL</button></div>`;
    }
    return `<h2>ROOM ${net.code || ''}</h2>${status}<div class="nf-row"><button data-act="cancel" class="nf-btn nf-dim">CANCEL</button></div>`;
  }

  function render() {
    if (mode === 'closed') return;
    const focusAct = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.dataset.act || 'code' : '';
    const input = /** @type {HTMLInputElement | null} */ (root.querySelector('.nf-code'));
    if (input) joinCode = input.value;
    root.innerHTML = `<div class="nf-panel" role="dialog" aria-modal="true">${html()}</div>`;
    const again = focusAct === 'code' ? root.querySelector('.nf-code') : focusAct && root.querySelector(`[data-act="${focusAct}"]`);
    const el = /** @type {HTMLElement | null} */ (again || root.querySelector('.nf-code') || root.querySelector('.nf-btn'));
    if (el) el.focus({ preventScroll: true });
  }

  async function act(a) {
    const input = /** @type {HTMLInputElement | null} */ (root.querySelector('.nf-code'));
    if (input) joinCode = input.value;
    if (a === 'close' || a === 'stay') { lobby.close(); return; }
    if (a === 'menu') { net.leave(); mode = 'menu'; render(); return; }
    if (a === 'cancel') { net.leave(); mode = 'menu'; render(); return; }
    if (a === 'leave') { lobby.close(); net.leave(); return; }
    if (a === 'host') { mode = 'host'; render(); net.host().catch(() => {}); return; }
    if (a === 'join') { mode = 'join'; render(); return; }
    if (a === 'go') { mode = 'join'; net.join(joinCode).catch(() => {}); render(); return; }
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(net.shareUrl(net.code)); flash('COPIED'); } catch { flash('COPY FAILED'); }
      return;
    }
    if (a === 'share') {
      try { await navigator.share({ title: 'Neon Stick Fight', text: `Fight me online, room ${net.code}`, url: net.shareUrl(net.code) }); } catch { /* dismissed */ }
    }
  }
  function flash(text) {
    const b = root.querySelector('[data-act="copy"]');
    if (b) { b.textContent = text; setTimeout(() => { if (b.isConnected) b.textContent = 'COPY LINK'; }, 1200); }
  }

  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
    if (b instanceof HTMLElement) act(b.dataset.act || '');
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement) { const p = t.selectionStart; t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); t.setSelectionRange(p, p); joinCode = t.value; }
  });
  // keyboard: arrows move between buttons, Enter presses, Escape backs out (capture phase, so the
  // game's own key handling never sees these while the panel is up)
  window.addEventListener('keydown', (e) => {
    if (mode === 'closed') return;
    e.stopImmediatePropagation();
    if (e.code === 'Escape') { e.preventDefault(); back(); }
    else if (e.code === 'Enter' && document.activeElement instanceof HTMLInputElement) { e.preventDefault(); act('go'); }
    else if (/^Arrow(Up|Down|Left|Right)$/.test(e.code) && !(document.activeElement instanceof HTMLInputElement && /Left|Right/.test(e.code))) { e.preventDefault(); move(/Up|Left/.test(e.code) ? -1 : 1); }
  }, true);
  window.addEventListener('keyup', (e) => { if (mode !== 'closed') e.stopImmediatePropagation(); }, true);
  // taps on the panel are the panel's: the attract screen behind it must not start a game
  for (const t of ['pointerdown', 'touchstart']) window.addEventListener(t, (e) => { if (lobby.busy) e.stopImmediatePropagation(); }, { capture: true, passive: true });

  function back() {
    if (mode === 'leave' || mode === 'message' || (mode === 'menu' && net.state === 'idle')) { lobby.close(); return; }
    act(mode === 'menu' || mode === 'join' && net.state === 'idle' ? 'close' : 'cancel');
  }
  function focusables() { return /** @type {HTMLElement[]} */ ([...root.querySelectorAll('.nf-code, .nf-btn')]); }
  function move(d) {
    const f = focusables(); if (!f.length) return;
    const i = f.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    f[(i + d + f.length) % f.length].focus();
  }
  // gamepad: D-pad or stick moves, A presses, B backs out; on the code box, up/down turn the letter
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let caret = 0, stickHeld = 0;
  function poll() {
    padRaf = requestAnimationFrame(poll);
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const g = pads.find(p => p && p.mapping === 'standard') || pads[0];
    if (!g) return;
    const down = g.buttons.map(b => b.pressed || b.value > 0.5);
    const ay = g.axes[1] || 0, ax = g.axes[0] || 0;
    const dir = down[12] || ay < -0.6 ? 'up' : down[13] || ay > 0.6 ? 'down' : down[14] || ax < -0.6 ? 'left' : down[15] || ax > 0.6 ? 'right' : '';
    const edge = (i) => down[i] && !padPrev[i];
    const stickEdge = dir && stickHeld === 0;
    stickHeld = dir ? stickHeld + 1 : 0;
    if (stickHeld > 18) stickHeld = 0;   // held: repeat
    padPrev = down;
    if (mode === 'closed') return;
    const input = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    if (edge(0)) { if (input) act('go'); else if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.click(); }
    else if (edge(1) || edge(8)) back();
    else if (stickEdge) {
      if (input && (dir === 'up' || dir === 'down')) {
        const v = input.value.padEnd(caret + 1, 'A').split('');
        const k = ALPHA.indexOf(v[caret]);
        v[caret] = ALPHA[(k + (dir === 'up' ? 1 : -1) + ALPHA.length) % ALPHA.length];
        input.value = v.join('').slice(0, 4); joinCode = input.value; input.setSelectionRange(caret, caret + 1);
      } else if (input && (dir === 'left' || dir === 'right')) {
        if (dir === 'right' && caret >= 3) move(1);
        else { caret = Math.max(0, Math.min(3, caret + (dir === 'right' ? 1 : -1))); input.setSelectionRange(caret, caret + 1); }
      } else move(dir === 'up' || dir === 'left' ? -1 : 1);
    }
  }

  const lobby = {
    render,
    open(m = 'menu', c = '') {
      mode = m === 'host' ? 'host' : m === 'join' ? 'join' : m;
      root.hidden = false;
      if (c) joinCode = String(c).toUpperCase();
      render();
      if (!padRaf) padRaf = requestAnimationFrame(poll);
      if (mode === 'host' && net.state === 'idle') net.host().catch(() => {});
      if (mode === 'join' && c) net.join(c).catch(() => {});
    },
    close() {
      if (mode === 'closed') return;
      mode = 'closed'; root.hidden = true; root.innerHTML = ''; closedAt = performance.now();
      cancelAnimationFrame(padRaf); padRaf = 0;
    },
    message(text) { msg = text; lobby.open('message'); },
    confirmLeave() { lobby.open('leave'); },
    get busy() { return mode !== 'closed' || performance.now() - closedAt < 300; },
  };
  return lobby;
}

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = `
  .nf-lobby { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
    background: rgba(7,2,15,0.55); font-family: 'Teko', 'Arial Narrow', system-ui, sans-serif;
    --pink: #ff2bd6; --cyan: #2ef2ff; --amber: #ffb02e; --violet: #a66bff; --ink: #fff4fd; }
  .nf-lobby[hidden] { display: none; }
  .nf-panel { min-width: min(420px, 86vw); max-width: 92vw; max-height: 92vh; overflow: auto; box-sizing: border-box;
    padding: clamp(12px, 3vmin, 26px) clamp(16px, 4vmin, 34px); text-align: center; color: var(--ink);
    background: rgba(14,4,30,0.9); border: 2px solid var(--cyan); border-radius: 2px;
    box-shadow: 0 0 18px rgba(46,242,255,0.55), inset 0 0 22px rgba(46,242,255,0.12); }
  .nf-panel h2 { margin: 0 0 clamp(8px, 2vmin, 16px); font: 400 clamp(20px, 5vmin, 34px)/1.05 'Bungee', 'Arial Black', Impact, sans-serif;
    color: #ffc2f3; text-shadow: 0 0 10px var(--pink), 0 0 2px var(--pink); letter-spacing: 0.02em; }
  .nf-roomcode { font: 400 clamp(40px, 13vmin, 84px)/1 'Bungee', 'Arial Black', Impact, sans-serif; letter-spacing: 0.12em;
    color: #ffe0a8; text-shadow: 0 0 14px var(--amber), 0 0 3px var(--amber); margin: 0 0 4px; user-select: all; -webkit-user-select: all; }
  .nf-link { margin: 0 0 4px; font: 500 clamp(15px, 3.4vmin, 20px)/1.1 'Teko', sans-serif; color: rgba(214,190,255,0.85);
    letter-spacing: 0.04em; word-break: break-all; user-select: all; -webkit-user-select: all; }
  .nf-status { margin: 4px 0 clamp(8px, 2vmin, 14px); font: 600 clamp(18px, 4vmin, 24px)/1 'Teko', sans-serif; letter-spacing: 0.1em;
    color: var(--cyan); text-shadow: 0 0 8px var(--cyan); animation: nf-blink 1.1s steps(1) infinite; }
  @keyframes nf-blink { 70% { opacity: 0.35; } }
  .nf-row, .nf-col { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .nf-col { flex-direction: column; align-items: stretch; }
  .nf-btn { --c: var(--cyan); appearance: none; cursor: pointer; min-height: 44px; padding: 6px 18px; border-radius: 2px;
    border: 2px solid var(--c); background: rgba(14,4,30,0.6); color: var(--c);
    font: 400 clamp(14px, 3.4vmin, 19px)/1 'Bungee', 'Arial Black', Impact, sans-serif; letter-spacing: 0.03em;
    text-shadow: 0 0 6px var(--c); box-shadow: 0 0 10px color-mix(in srgb, var(--c) 60%, transparent), inset 0 0 8px color-mix(in srgb, var(--c) 30%, transparent);
    touch-action: manipulation; }
  .nf-btn.nf-pink { --c: var(--pink); } .nf-btn.nf-dim { --c: var(--violet); }
  .nf-btn:hover, .nf-btn:focus-visible, .nf-btn:focus { outline: none; background: var(--c); color: #12041f; text-shadow: none;
    box-shadow: 0 0 20px var(--c), 0 0 40px color-mix(in srgb, var(--c) 45%, transparent); }
  .nf-code { display: block; box-sizing: border-box; width: 100%; max-width: 300px; margin: 0 auto clamp(10px, 2.4vmin, 16px); padding: 4px 0 0;
    text-align: center; font: 400 clamp(36px, 11vmin, 64px)/1.1 'Bungee', 'Arial Black', Impact, sans-serif; letter-spacing: 0.25em; text-indent: 0.25em;
    text-transform: uppercase; color: #ffe0a8; caret-color: var(--amber); background: rgba(7,2,15,0.7);
    border: 2px solid var(--amber); border-radius: 2px; box-shadow: 0 0 12px rgba(255,176,46,0.5); }
  .nf-code::placeholder { color: rgba(255,176,46,0.3); }
  .nf-code:focus { outline: none; box-shadow: 0 0 20px rgba(255,176,46,0.85); }
  .nf-readout { position: absolute; left: 2.4%; bottom: 2%; z-index: 5; pointer-events: none;
    font: 500 clamp(12px, 1.6vw, 18px)/1 'Teko', 'Arial Narrow', sans-serif; letter-spacing: 0.1em; color: #b9f9ff;
    text-shadow: 0 0 6px #2ef2ff, 0 0 2px #000; display: flex; gap: 0.6em; align-items: baseline; white-space: nowrap; }
  .nf-readout[hidden] { display: none; }
  html.online .sf-hint { display: none; }   /* the "press any key for sound" hint sits under the readout */
  .nf-readout.nf-relay { color: #ffe0a8; text-shadow: 0 0 6px #ffb02e, 0 0 2px #000; }
  .nf-readout b { font-weight: 600; }
  .nf-desync { color: #ffc2f3; text-shadow: 0 0 8px #ff2bd6, 0 0 2px #000; }
  .nf-wait { color: #fff4fd; animation: nf-blink 1.1s steps(1) infinite; }
  html.touch-ui .nf-readout { bottom: auto; top: calc(var(--nf-top, 74px)); left: 50%; transform: translateX(-50%); }
  /* online: no horde toggle on the touch layer */
  html.online .tc-top [data-tap="KeyG"] { display: none; }`;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}
