#!/usr/bin/env node
// The custom employee (README, Characters, Custom employee): `npm run test:moves`. No browser, a few minutes:
//   - the catalog: every own move in every character file says whether it transfers (true, or why not), and the
//     catalog (src/career/moves.js) is exactly the true ones, named as the fighters' own move lists name them
//   - the slots' inputs: ↓ 1+3 and ↓ 2+4 are nobody's command, and the shared table has no move of its own there
//   - the loadout rules: owned keys, slot keys, the fighter's own move refused, no move twice, the look string
//   - the real sim: each move out of slot A and slot B on bodies of every size, an empty slot still the throw, a
//     held body still breaking a throw with the same buttons, a sim with empty slots hashing as before
//   - no loops: every move and every pair of launchers pressed as fast as the sim takes them against a dummy (open
//     and at the wall): every combo ends, none past 8 hits, no juggle past the cap
//   - the CPU: it uses a borrowed move, and CPU vs CPU at 0.7 with random loadouts (every fighter) finishes every
//     match with the sim's invariants holding on every step; a CPU with a loadout against the same fighter without
//     one wins about as often as it loses (moves are sidegrades)
import { MOVES, MOVE_PRICE, SLOTS, moveInfo, movesFor, moveKey, isMoveKey, slotKey, canSlot, loadoutOf, cleanLoadout, loadoutText, parseLoadout } from '../../src/career/moves.js';
import { isOwnable } from '../../src/career/mastery.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const QUICK = process.argv.includes('--quick');

const { installDom } = await import('../netsim/env.mjs'); installDom();
const { roster } = await import('../../src/characters/index.js');
const { FRAME_DATA } = await import('../../src/combat/frameData.js');
const { SHARED_INPUTS, moveListOf } = await import('../../src/combat/moveinfo.js');

// ---- the catalog ---------------------------------------------------------------------------------------------------
const cast = roster();
{
  const own = cast.flatMap((c) => c.ownMoves.map((m) => ({ c, m, fd: FRAME_DATA[m] })));
  const unflagged = own.filter((x) => !(x.fd.transfer === true || (typeof x.fd.transfer === 'string' && x.fd.transfer.length > 10)));
  ok('every own move in every character file says whether it transfers (true, or why not)', !unflagged.length, unflagged.map((x) => x.m).join(', '));
  const yes = own.filter((x) => x.fd.transfer === true).map((x) => x.m).sort();
  ok('the catalog is exactly the moves marked transfer: true', JSON.stringify(yes) === JSON.stringify(MOVES.map((m) => m.id).sort()), `${yes.length} marked, ${MOVES.length} listed`);
  ok('each catalog entry names its real owner', MOVES.every((m) => FRAME_DATA[m.id] && FRAME_DATA[m.id].owner === m.fighter));
  const named = MOVES.filter((m) => { const c = cast.find((x) => x.id === m.fighter); return c.moveList.some((e) => e.name.replace(/[^A-Z]/g, '') === m.name.replace(/[^A-Z]/g, '')); });
  ok('...and calls it what its fighter\'s move list does', named.length === MOVES.length, MOVES.filter((m) => !named.includes(m)).map((m) => m.id).join(', '));
  ok('only standalone presses are for sale: each is one of its owner\'s commands', MOVES.every((m) => cast.find((c) => c.id === m.fighter).commands.some((k) => k.move === m.id)));
  ok('nothing that leans on a prop, a cloth or an owner-only hook: no stance, parry, throw counter, feint or air-only move', MOVES.every((m) => { const fd = FRAME_DATA[m.id]; return !fd.stance && !fd.parry && !fd.throwCounter && !fd.feint && !fd.air && !fd.stanceOnly; }));
  ok('BARISTA\'s Espresso Shot stays his (the cup)', FRAME_DATA.ba_espresso.transfer !== true && /cup/.test(FRAME_DATA.ba_espresso.transfer));
  ok('the out list says why: the cord, the stance, the counters, the feint, the air', ['receptionist_pleaseHold', 'wellness_treePose', 'ticketClosed', 'lawyer_objection', 'sr_coldCall', 'squeegeeDive'].every((m) => typeof FRAME_DATA[m].transfer === 'string'));
  ok(`one fixed price, ${MOVE_PRICE} sticks`, MOVE_PRICE === 300);
  ok('two slots: ↓ 1+3 and ↓ 2+4, the same for every fighter', SLOTS.length === 2 && SLOTS[0].input === '↓ 1+3' && SLOTS[1].input === '↓ 2+4');
  const taken = cast.flatMap((c) => c.commands.filter((k) => (k.button === '1+3' || k.button === '2+4') && ['d', 'df', 'db'].includes(k.motion)).map((k) => `${c.id}:${k.move}`));
  ok('nobody has a command on ↓ 1+3 or ↓ 2+4 (or with ↘ ↙)', !taken.length, taken.join(', '));
  ok('the shared table has no move of its own there (it was the plain throw)', !SHARED_INPUTS.some((x) => (x.button === '1+3' || x.button === '2+4') && x.motion !== ''));
  const per = cast.map((c) => movesFor(c.id).length);
  ok('every fighter can borrow every move but its own', cast.every((c) => movesFor(c.id).every((m) => m.fighter !== c.id) && movesFor(c.id).length === MOVES.filter((m) => m.fighter !== c.id).length), `from ${Math.min(...per)} to ${Math.max(...per)}`);
}

// ---- the loadout rules ---------------------------------------------------------------------------------------------
{
  ok('owned once, as move:<id>', moveKey('reboot') === 'move:reboot' && isMoveKey('move:reboot') && !isMoveKey('move:ba_espresso') && !isMoveKey('move:nope') && !isMoveKey(3));
  ok('isOwnable takes a catalog move and nothing else like it', isOwnable('move:mopSpin') && !isOwnable('move:wellness_treePose') && !isOwnable('move:'));
  ok('slots live in equip as fighter:slot1 / slot2', slotKey('courier', 1) === 'courier:slot1' && slotKey('courier', 2) === 'courier:slot2');
  const owned = [moveKey('reboot'), moveKey('mopSpin'), moveKey('expressSlide')];
  ok('canSlot: owned and not the fighter\'s own', canSlot(owned, 'temp', 'reboot') === 'ok' && canSlot(owned, 'helpdesk', 'reboot') === 'own' && canSlot(owned, 'temp', 'updraft') === 'not-owned' && canSlot(owned, 'temp', 'ba_espresso') === 'unknown');
  const c = { owned, equip: { 'temp:slot1': 'reboot', 'temp:slot2': 'updraft', 'courier:slot1': 'expressSlide', 'courier:slot2': 'mopSpin', 'janitor:slot1': 'mopSpin', 'chef:slot1': 'reboot', 'chef:slot2': 'reboot' } };
  ok('loadoutOf: only owned moves count (owning isn\'t slotting, and slotting needs owning)', loadoutOf(c, 'temp').join() === 'reboot,' && loadoutOf(c, 'intern').join() === ',');
  ok('...never the fighter\'s own move (COURIER can\'t borrow Express Slide)', loadoutOf(c, 'courier').join() === ',mopSpin' && loadoutOf(c, 'janitor').join() === ',');
  ok('...and no move twice', loadoutOf(c, 'chef').join() === 'reboot,');
  ok('cleanLoadout: junk, unknowns and repeats are empty slots', cleanLoadout('temp', ['reboot', 'reboot']).join() === 'reboot,' && cleanLoadout('temp', ['x', 7]).join() === ',' && cleanLoadout('temp', null).join() === ',');
  ok('the look string: ~a.b, ~.b, nothing when empty, and back', loadoutText(['reboot', 'mopSpin']) === '~reboot.mopSpin' && loadoutText(['', 'mopSpin']) === '~.mopSpin' && loadoutText(['', '']) === ''
    && parseLoadout('temp', 'reboot.mopSpin').join() === 'reboot,mopSpin' && parseLoadout('janitor', 'reboot.mopSpin').join() === 'reboot,' && parseLoadout('temp', '').join() === ',');
  ok('moveInfo: a catalog move, or null', moveInfo('reboot').fighter === 'helpdesk' && moveInfo('ba_espresso') === null);
  const ml = moveListOf(cast.find((x) => x.id === 'temp'), ['reboot', '']);
  ok('the move list shows the slots: the move on ↓ 1+3, EMPTY on ↓ 2+4, borrowed from its owner', ml.slots.length === 2 && ml.slots[0].name === 'REBOOT' && ml.slots[0].input === '↓ 1+3' && /HELPDESK/i.test(ml.slots[0].note) && ml.slots[1].empty && ml.slots[0].seq.length > 0);
}

// ---- online: the look carries the slots ----------------------------------------------------------------------------
{
  const { cleanSetup } = await import('../../src/net/watchlog.js');
  const { NET_VERSION, LOOK_MAX } = await import('../../src/net/online.js');
  ok('NET_VERSION is 27', NET_VERSION === 27);
  const st = cleanSetup({ n: 1, v: 27, seed: 1, chars: ['temp', 'chef'], pals: ['coldBrew+pt~reboot.mopSpin', '~.electrician_groundFault'], rules: {} });
  ok('spectators get both looks, slots and all, in the setup', st.pals[0] === 'coldBrew+pt~reboot.mopSpin' && st.pals[1] === '~.electrician_groundFault');
  ok('...and junk is dropped', cleanSetup({ n: 1, v: 27, seed: 1, chars: [], pals: ['<b>', 'x~y.z.w'], rules: {} }).pals.join() === ',');
  const longest = `pumpkinSpice+pt~${MOVES.map((m) => m.id).sort((a, b) => b.length - a.length).slice(0, 2).join('.')}`;
  ok('the longest look fits LOOK_MAX', longest.length <= LOOK_MAX, `${longest.length} of ${LOOK_MAX}`);
}

// ---- the real sim --------------------------------------------------------------------------------------------------
const { createArena } = await import('../../src/arena/index.js');
const { createCombat } = await import('../../src/combat/sim.js');
const { EMPTY_INPUT } = await import('../../src/combat/input.js');
const { createFighter, MOVES: CLIPS, MOVE_DATA } = await import('../../src/fighter/index.js');
const { hashSim } = await import('../../src/net/hash.js');
const { createInvariants } = await import('../../src/combat/invariants.js');
const { mulberry32 } = await import('../../src/combat/rng.js');
function makeSim(ids, slots = [], p1 = null) {
  const arena = createArena('building'), sp = arena.spawns;
  const rigs = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim;
  const input = { snapshot: () => (p1 ? p1(sim) : EMPTY_INPUT) };
  const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters: rigs, arena, input, onEvent() {}, makeRig, moves: CLIPS, moveData: MOVE_DATA });
  sim.setCharacters(ids, [], [], slots.map((m) => (m ? { moves: m } : null)));
  return sim;
}
// ↓ + both buttons of a slot, every `gap` steps for a 2-step press (A, or alternating A and B)
const slotPresser = (gap, alt = false) => { let n = 0, k = 0; return () => { n++; const t = n % gap; if (t === 0) k++; const A = !alt || k % 2 === 0; return t >= 1 && t < 3 ? { ...EMPTY_INPUT, down: true, lp: A, lk: A, rp: !A, rk: !A } : t === 0 || t === 3 ? { ...EMPTY_INPUT, down: true } : EMPTY_INPUT; }; };
function place(sim, gap = 90, wall = false) {
  if (wall) sim.units[1].x = sim.bounds.x1 - 40;
  sim.units[0].x = sim.units[1].x - gap;
}
{
  // every move out of slot A on three bodies (small, standard, big) and out of slot B on TEMP
  const bad = [];
  for (const who of ['intern', 'temp', 'chef']) for (const m of MOVES) {
    if (m.fighter === who) continue;
    for (const slot of who === 'temp' ? [0, 1] : [0]) {
      const lo = slot ? [null, m.id] : [m.id, null];
      const sim = makeSim([who, 'temp'], [lo], slotPresser(400, slot === 1));
      sim.setHuman(0); sim.setController(1, 'none'); sim.resetMatch({ seed: 1, skipIntro: true }); place(sim);
      if (slot === 1) { let n = 0; sim.setController(0, 'human', () => { n++; return n >= 2 && n < 4 ? { ...EMPTY_INPUT, down: true, rp: true, rk: true } : EMPTY_INPUT; }); }
      let seen = false;
      for (let t = 0; t < 120 && !seen; t++) { sim.tick(); if (sim.units[0].move === m.id) seen = true; }
      if (!seen) bad.push(`${who}:${m.id}:${slot ? 'B' : 'A'}`);
    }
  }
  ok('every borrowed move comes out of its slot on INTERN, TEMP and CHEF (slot B on TEMP too)', !bad.length, bad.slice(0, 6).join(', '));

  // empty slots: ↓ 1+3 is still the throw
  const e = makeSim(['temp', 'temp'], [], slotPresser(400)); e.setHuman(0); e.setController(1, 'none'); e.resetMatch({ seed: 1, skipIntro: true }); place(e, 70);
  let thrown = false; for (let t = 0; t < 60; t++) { e.tick(); if (e.units[0].move === 'throw') thrown = true; }
  ok('an empty slot: ↓ 1+3 is the throw it always was', thrown);
  // a fighter's own move can't be slotted (it already has it on its own input)
  const own = makeSim(['helpdesk', 'temp'], [['reboot', 'mopSpin']]);
  ok('the fighter\'s own move is refused in a slot (HELPDESK and Reboot), the other stays', own.units[0].borrow.join() === ',mopSpin' && own.units[0].loadout === ',mopSpin');
  const junk = makeSim(['temp', 'temp'], [['ba_espresso', 'squeegeeDive']]);
  ok('a move that doesn\'t transfer is refused (Espresso Shot, Squeegee Dive)', junk.units[0].borrow.every((m) => m === null) && junk.units[0].loadout === '');
  // a held body breaks a throw with the same buttons, slots or not
  const br = makeSim(['temp', 'temp'], [null, ['reboot', 'mopSpin']], null);
  let k1 = 0; br.setController(0, 'human', () => { k1++; return k1 >= 3 && k1 < 5 ? { ...EMPTY_INPUT, lp: true, lk: true } : EMPTY_INPUT; });
  let k2 = 0; br.setController(1, 'human', () => { k2++; return br.units[1].state === 'grabbed' && k2 % 2 ? { ...EMPTY_INPUT, down: true, lp: true, lk: true } : EMPTY_INPUT; });
  br.resetMatch({ seed: 1, skipIntro: true }); br.units[1].x = br.units[0].x + 70;
  let broke = false, grabbed = false;
  const brLog = () => br.log.some((x) => x.type === 'throwBreak' || x.type === 'break' || (x.type === 'callout' && /BREAK/.test(x.text)));
  for (let t = 0; t < 240 && !broke; t++) { br.tick(); if (br.units[1].state === 'grabbed') grabbed = true; if (brLog()) broke = true; }
  ok('held in a grab, ↓ 1+3 still breaks it (the slot never fires there)', grabbed && broke);
  // a sim with empty slots is the sim it was: two sims step for step, hashes equal
  const a = makeSim(['barista', 'lawyer']), b = makeSim(['barista', 'lawyer'], [[null, null], ['', '']]);
  for (const s of [a, b]) { s.setAI(0, 0.7); s.setAI(1, 0.7); s.resetMatch({ seed: 9, fresh: true }); }
  let same = true;
  for (let t = 0; t < 120 * 20; t++) { a.tick(); b.tick(); if (t % 120 === 0 && hashSim(a) !== hashSim(b)) { same = false; break; } }
  ok('empty slots: 20 s of CPU play hash the same as a sim never told about slots', same);
  // the slots are in the state hash, and so is a borrowed move's reach only where it's slotted
  const h0 = makeSim(['chef', 'temp'], [['reboot', null]]), h1 = makeSim(['chef', 'temp'], [['mopSpin', null]]);
  for (const s of [h0, h1]) s.resetMatch({ seed: 3, fresh: true });
  ok('two different loadouts hash differently (both pages must agree on them)', hashSim(h0) !== hashSim(h1));
  const h2 = makeSim(['chef', 'temp'], [['reboot', null]]); h2.setCharacters(['chef', 'temp'], [], [], [{ moves: ['mopSpin', null] }]); h2.resetMatch({ seed: 3, fresh: true });
  ok('a borrowed move measured in an earlier match doesn\'t leak into the next one\'s hash', hashSim(h2) === hashSim(h1));
}

// ---- no loops ------------------------------------------------------------------------------------------------------
// pressed as fast as the sim will take them, on a dummy that stands there (P1 never runs out of stamina): the longest
// combo, the most juggle hits, and how long a combo lasts. A loop shows as a combo that never ends.
function hammer(who, a, b, gap, wall) {
  const sim = makeSim([who, 'temp'], [[a, b]], slotPresser(gap, !!b));
  sim.setHuman(0); sim.setController(1, 'none'); sim.resetMatch({ seed: 1, skipIntro: true, startHealth: 400 }); place(sim, 90, wall);
  // a combo's span: from its first hit to its latest (the sim counts a hit into a combo only while the last one's stun lasts)
  let max = 0, air = 0, start = -1, longest = 0;
  for (let t = 0; t < 1200; t++) {
    sim.units[0].stamina = sim.units[0].staminaMax;
    sim.tick();
    const d = sim.units[1];
    if (d.comboBy === 0 && d.combo === 1 && d.lastHitAt !== start && (start < 0 || d.lastHitAt > start)) { if (d.combo === 1) start = d.lastHitAt; }
    if (d.comboBy === 0 && d.combo > 1 && start >= 0) longest = Math.max(longest, d.lastHitAt - start);
    if (d.comboBy === 0) max = Math.max(max, d.combo);
    air = Math.max(air, d.airHits || 0);
  }
  return { max, air, longest };
}
{
  const gaps = QUICK ? [10, 20] : [6, 10, 14, 20, 28, 40], bodies = QUICK ? ['temp'] : ['temp', 'courier', 'chef'];
  let worst = { max: 0 }, airMax = 0, longest = 0;
  for (const m of MOVES) for (const who of bodies) if (who !== m.fighter) for (const gap of gaps) for (const wall of [false, true]) {
    const r = hammer(who, m.id, null, gap, wall);
    if (r.max > worst.max) worst = { ...r, m: m.id, who, gap, wall };
    airMax = Math.max(airMax, r.air); longest = Math.max(longest, r.longest);
  }
  ok('one move pressed as fast as it goes: every combo ends, none past 8 hits', worst.max <= 8 && longest < 120 * 4, `worst ${worst.max} hits (${worst.m} on ${worst.who}), longest combo ${(longest / 120).toFixed(1)} s`);
  const L = ['dropOffKnee', 'updraft', 'chef_flambe', 'ceo_takeover', 'finePrint', 'lawyer_crossExam', 'paperCut', 'electrician_liveWire', 'ba_pourOver', 'shoulderCheck'];
  let pw = { max: 0 };
  for (const a of L) for (const b of L) if (a !== b) for (const who of QUICK ? ['temp'] : ['temp', 'chef']) for (const gap of QUICK ? [12] : [8, 12, 16, 24]) for (const wall of [false, true]) {
    if (moveInfo(a).fighter === who || moveInfo(b).fighter === who) continue;
    const r = hammer(who, a, b, gap, wall);
    if (r.max > pw.max) pw = { ...r, a, b, who };
    airMax = Math.max(airMax, r.air); longest = Math.max(longest, r.longest);
  }
  ok('two launchers and pokes in the two slots, alternated: every combo ends, none past 8 hits', pw.max <= 8 && longest < 120 * 4, `worst ${pw.max} hits (${pw.a} + ${pw.b} on ${pw.who})`);
  ok('no juggle past the sim\'s cap of 4 air hits', airMax <= 4, `most ${airMax}`);
}

// ---- the CPU --------------------------------------------------------------------------------------------------------
{
  // it uses a borrowed move: its owner's specials come with it
  const s = makeSim(['temp', 'temp'], [['ba_pourOver', 'hr_training']]);
  s.setAI(0, 0.8); s.setAI(1, 0.5); s.resetMatch({ seed: 4, fresh: true });
  const used = new Set();
  for (let t = 0; t < 120 * 60; t++) { s.tick(); const u = s.units[0]; if (u.move && u.borrow.includes(u.move)) used.add(u.move); if (s.phase === 'match') break; }
  ok('a CPU with a loadout uses its borrowed moves', used.size >= 1, [...used].join(', '));

  // CPU vs CPU at 0.7, random loadouts on both, every fighter: every match ends, the invariants hold every step
  const r = mulberry32(77), ids = cast.map((c) => c.id), rand = (f) => { const pool = movesFor(f).map((m) => m.id); return [pool.splice(Math.floor(r() * pool.length), 1)[0], pool[Math.floor(r() * pool.length)]]; };
  let finished = 0, n = 0, broke = '', lent = 0, steps = 0;
  for (let i = 0; i < ids.length; i++) for (const seed of QUICK ? [1] : [1, 2]) {
    const pair = [ids[i], ids[(i + 3 + seed) % ids.length]];
    const sim = makeSim(pair, [rand(pair[0]), rand(pair[1])]);
    sim.setAI(0, 0.7); sim.setAI(1, 0.7); sim.roundTime = 30;
    sim.resetMatch({ seed: seed * 100 + i, startHealth: 60, fresh: true });
    const check = createInvariants(sim), aid = [-1, -1];
    n++;
    for (let t = 0; t < 120 * 200 && sim.phase !== 'match'; t++) {
      sim.tick(); steps++;
      const bad = check();
      if (bad && !broke) broke = `${pair.join(' v ')} seed ${seed}: ${bad.rule} unit ${bad.unit} ${bad.detail}`;
      for (const u of sim.units) if (u.move && u.borrow.includes(u.move) && aid[u.id] !== u.attackId) { aid[u.id] = u.attackId; lent++; }
    }
    if (sim.phase === 'match') finished++;
  }
  ok(`CPU vs CPU at 0.7 with random loadouts: all ${n} matches finish`, finished === n, `${finished} / ${n}`);
  ok('...the sim\'s invariants hold on every step', !broke, broke || `${steps.toLocaleString()} steps`);
  ok('...and the borrowed moves get used', lent > n, `${lent} borrowed strikes`);

  // moves are sidegrades: the same fighter with and without a loadout, CPU 0.7 both, sides swapped half the time
  let withWins = 0, games = 0;
  for (const f of QUICK ? ['temp', 'chef', 'courier'] : ['temp', 'chef', 'courier', 'lawyer', 'wellness', 'security']) for (const seed of QUICK ? [1, 2] : [1, 2, 3, 4]) {
    const lo = rand(f), side = seed % 2;
    const sim = makeSim([f, f], side ? [null, lo] : [lo, null]);
    sim.setAI(0, 0.7); sim.setAI(1, 0.7); sim.roundTime = 30;
    sim.resetMatch({ seed: seed * 7 + f.length, startHealth: 60, fresh: true });
    for (let t = 0; t < 120 * 200 && sim.phase !== 'match'; t++) sim.tick();
    games++; if (sim.winner === side) withWins++;
  }
  const share = withWins / games;
  ok('a loadout is no big edge: the side with one wins between 25% and 75% of mirror matches', share >= 0.25 && share <= 0.75, `${withWins} of ${games}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
