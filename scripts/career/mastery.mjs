#!/usr/bin/env node
// Fighter mastery (README, Progression, Fighter mastery): `npm run test:mastery`. No browser, about 10 s:
//   - the ranks, and what each one unlocks for every fighter (the cast's data and clips all there, taunts short enough)
//   - what pays: the match's own career XP (technique, never hits or presses), NEW HIRE for the first matches, nothing
//     for training, the daily bonuses and shifts kept out, the offline cap respected, a cut match not counted as a hire
//   - unlocks landing in owned the moment a rank is reached (a pose or taunt switched on), the merge, a forged state
//   - pacing: how many ordinary matches reach each rank
//   - the real sim: a masher pays the base; a taunt plays only under the next ROUND card, from the last round's winner,
//     and never into the fight; a victory pose replaces the dance; the invariants hold all the way through
import { readFileSync } from 'node:fs';
import { RANKS, MAX_RANK, NEW_HIRE, UNLOCKS, KIT, MASTERY_FIGHTERS, MASTERY_MERGE_MAX, rankFor, masteryOf, unlocksFor, earlyRank, masteryItems,
  isOwnable, cleanMastery, mergeMastery, payWithMastery, applyWithMastery, grantAll, kitOn, kitKey, kitItemKey } from '../../src/career/mastery.js';
import { blankCareer, OFFLINE_CAP, PAY, DAILY } from '../../src/career/rules.js';
import { palettesFor, masteryPalette, palette, itemKey, PRICES } from '../../src/career/palettes.js';
import { SHIFT_PAY } from '../../src/career/shifts.js';
import { createBook } from '../../src/bookkeeping.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const DAY = '2026-11-12';
const C = (o = {}) => ({ ...blankCareer(), ...o });
const M = (o = {}) => ({ mode: 'arcade', won: false, cut: false, fought: 60, parries: 0, punishes: 0, enders: 0, accidents: 0, perfects: 0, floors: 0, fighter: 'barista', rounds: 0, stage: 1, ...o });

// ---- the ranks and the cast ------------------------------------------------------------------------------------
{
  ok('five ranks, each further than the last', MAX_RANK === 5 && RANKS.every((x, i) => i === 0 || x - RANKS[i - 1] > (i > 1 ? RANKS[i - 1] - RANKS[i - 2] : 0)));
  ok('rankFor: 0 at 0, 1 at 100, just short stays put, the top is 5 with no bar', rankFor(0).rank === 0 && rankFor(100).rank === 1 && rankFor(299).rank === 1 && rankFor(99999).rank === 5 && rankFor(99999).span === 0);
  ok('rankFor: the bar into the next rank', rankFor(400).into === 100 && rankFor(400).span === 350);
  const roster = (readFileSync(new URL('../../worker/roster.ts', import.meta.url), 'utf8').match(/FIGHTERS = \[([^\]]*)\]/) || ['', ''])[1].match(/"([^"]+)"/g).map((x) => x.slice(1, -1));
  ok('every fighter in the roster has its mastery names, and no one else', roster.length === MASTERY_FIGHTERS.length && roster.every((f) => MASTERY_FIGHTERS.includes(f)));
  ok('every fighter has a mastery-only palette that is never for sale', roster.every((f) => { const p = masteryPalette(f); return p && !p.price && p.mastery === MAX_RANK && palette(f, p.id) === p && !palettesFor(f).includes(p); }));
  ok('flat solid colors: every mastery palette is three #rrggbb', roster.every((f) => { const p = masteryPalette(f); return [p.body, p.pants, p.accent].every((c) => /^#[0-9a-f]{6}$/i.test(c)); }));
  ok('mastery palette ids are their own (no clash with a sold one)', roster.every((f) => !palettesFor(f).some((p) => p.id === masteryPalette(f).id)));
  const u = unlocksFor('barista');
  ok('what the ranks unlock: 1 the 150 palette, 2 the taunt, 3 the 300 palette, 4 the pose, 5 the 600 palette and the mastery palette',
    u.map((x) => `${x.rank}${x.kind}${x.price || ''}`).join() === `1palette${PRICES[0]},2taunt,3palette${PRICES[1]},4pose,5palette${PRICES[2]},5palette`);
  ok('the unlock table is the README\'s: six unlocks over five ranks', UNLOCKS.length === 6 && UNLOCKS.every((x) => x.rank >= 1 && x.rank <= MAX_RANK));
  ok('earlyRank: the sold palettes come early at 1, 3, 5', palettesFor('chef').map((p) => earlyRank('chef', p.id)).join() === '1,3,5');
  ok('masteryItems: the mastery palette, the taunt and the pose, rank-only', masteryItems('chef').map((x) => `${x.kind}${x.mastery}`).sort().join() === 'palette5,pose4,taunt2' && masteryItems('chef').every((x) => !x.price));
  ok('names: a pose and a taunt for every fighter, in capitals', Object.values(KIT).every(([p, t]) => p && t && p === p.toUpperCase() && t === t.toUpperCase()));

  const { installDom } = await import('../netsim/env.mjs'); installDom();
  const { getCharacter } = await import('../../src/characters/index.js');
  const { TAUNT_MAX_MS } = await import('../../src/characters/registry.js');
  const { RIG_KIT } = await import('../../src/fighter/index.js');
  const RIG = new Proxy({}, { get: (_, n) => RIG_KIT.base(String(n)) });   // the registered clips (MOVE_DEFS)
  const missing = roster.filter((f) => { const c = getCharacter(f); return !c || !c.victory || !c.taunt || !RIG[c.victory] || !RIG[c.taunt]; });
  ok('every character file has its victory and taunt clips, registered', missing.length === 0, missing.join(', '));
  const long = roster.filter((f) => { const c = getCharacter(f); return RIG[c.taunt].keys.reduce((s, k) => s + k.d, 0) > TAUNT_MAX_MS; });
  ok(`every taunt is over in ${TAUNT_MAX_MS} ms, before FIGHT`, long.length === 0, long.join(', '));
  ok('a pose holds (no loop) and a taunt plays once', roster.every((f) => { const c = getCharacter(f); return !RIG[c.victory].loop && !RIG[c.taunt].loop; }));
}

// ---- what pays ---------------------------------------------------------------------------------------------------
{
  const a = payWithMastery(M({ won: true, parries: 3, enders: 2 }), C(), DAY);
  const career = a.lines.filter((l) => l.id !== 'firstWin' && l.id !== 'firstOnline' && l.id !== 'shift').reduce((s, l) => s + l.xp, 0);
  ok('mastery XP is the match\'s own career XP, plus NEW HIRE on a first match', a.mastery.xp === career && a.mastery.hire === NEW_HIRE.xp && a.mastery.total === career + NEW_HIRE.xp);
  ok('the daily first win and the shifts are not in it (they\'re about the day)', a.firstWin && a.mastery.xp === a.xp - DAILY.firstWin.xp - a.lines.filter((l) => l.id === 'shift').length * SHIFT_PAY.xp);
  const mash = payWithMastery(M({ hits: 999, presses: 5000, combo: 40 }), C({ mastery: { barista: { xp: 0, n: 5 } } }), DAY);
  ok('the mash case: 999 hits, 5,000 presses, a 40-hit combo pay the base only', mash.mastery.xp === PAY.base.xp && mash.mastery.total === PAY.base.xp);
  ok('training and the dummy pay nothing, so no mastery', !payWithMastery(M({ mode: 'training' }), C(), DAY).mastery && !payWithMastery(M({ mode: 'dummy' }), C(), DAY).mastery);
  ok('an unknown fighter pays the career but no mastery', !payWithMastery(M({ fighter: 'nobody' }), C(), DAY).mastery && payWithMastery(M({ fighter: 'nobody' }), C(), DAY).xp > 0);
  let c = C();
  const hires = [];
  for (let i = 0; i < 5; i++) { const w = payWithMastery(M(), c, DAY); hires.push(w.mastery.hire); c = applyWithMastery(c, w, DAY); }
  ok(`NEW HIRE pays the first ${NEW_HIRE.matches} matches with a fighter, then stops`, hires.join() === '25,25,25,0,0' && masteryOf(c, 'barista').n === 5);
  const w2 = payWithMastery(M({ fighter: 'chef' }), c, DAY);
  ok('...and starts fresh for the next fighter tried', w2.mastery.hire === NEW_HIRE.xp);
  const cut = payWithMastery(M({ cut: true, fought: 45 }), C(), DAY);
  ok('a match cut short pays its base to mastery, no NEW HIRE, and isn\'t counted as a match', cut.mastery.total === PAY.base.xp && cut.mastery.hire === 0 && cut.mastery.n === 0);
  const capped = payWithMastery(M({ won: true, parries: 9 }), C({ offDay: DAY, offXp: OFFLINE_CAP.xp - 5, offSticks: 0, mastery: { barista: { xp: 0, n: 9 } } }), DAY);
  ok('the offline cap holds for mastery too: what the match was capped to', capped.capped && capped.mastery.xp === 5);
  const online = payWithMastery(M({ mode: 'quick', won: true, parries: 2 }), C(), DAY);
  ok('online pays mastery the same way', online.mastery && online.mastery.xp === online.match.xp);
}

// ---- unlocks, the merge, a forged state ---------------------------------------------------------------------------
{
  let c = C({ mastery: { barista: { xp: RANKS[1] - 5, n: 9 } } });
  const w = payWithMastery(M({ won: true }), c, DAY);
  ok('a rank-up says so: before 0, after 1, and what it unlocked', w.mastery.before === 0 && w.mastery.after === 1 && w.mastery.unlocked.length === 1 && w.mastery.unlocked[0].kind === 'palette');
  c = applyWithMastery(c, w, DAY);
  ok('...and the unlock is in owned, with no sticks spent', c.owned.includes(itemKey('barista', palettesFor('barista')[0].id)) && c.sticks === w.sticks);
  c = applyWithMastery(C({ mastery: { barista: { xp: RANKS[2] - 1, n: 9 } } }), payWithMastery(M(), C({ mastery: { barista: { xp: RANKS[2] - 1, n: 9 } } }), DAY), DAY);
  ok('the taunt unlocks at 2 and is switched on', c.owned.includes(kitItemKey('barista', 'taunt')) && kitOn(c, 'barista').taunt && !kitOn(c, 'barista').pose);
  const off = { ...c, equip: { ...c.equip } }; delete off.equip[kitKey('barista', 'taunt')];
  ok('switched off, it stays owned and off', !kitOn(off, 'barista').taunt && off.owned.includes(kitItemKey('barista', 'taunt')));
  const big = grantAll(C({ mastery: { chef: { xp: RANKS[5], n: 99 } } }));
  ok('grantAll: rank 5 owns every chef unlock, the pose and taunt on', unlocksFor('chef').every((u) => big.owned.includes(u.key)) && kitOn(big, 'chef').pose && kitOn(big, 'chef').taunt);
  ok('...and nothing for anyone else', !big.owned.some((k) => !k.startsWith('chef:')));
  ok('isOwnable: palettes, a fighter\'s pose and taunt; not made-up keys', isOwnable('chef:sous') && isOwnable(itemKey('chef', masteryPalette('chef').id)) && isOwnable('chef:pose:victory') && isOwnable('chef:taunt:taunt')
    && !isOwnable('chef:pose:dab') && !isOwnable('nobody:pose:victory') && !isOwnable('chef:hat:x') && !isOwnable(7));
  ok('cleanMastery: unknown fighters, junk and negatives go', JSON.stringify(cleanMastery({ chef: { xp: 50.7, n: 2 }, nobody: { xp: 5 }, barista: { xp: -4, n: 'x' }, __proto__: { xp: 1 } })) === '{"chef":{"xp":50,"n":2}}');
  const acct = { chef: { xp: 800, n: 30 }, barista: { xp: 10, n: 1 } };
  const merged = mergeMastery(acct, { chef: { xp: 300, n: 40 }, barista: { xp: 400, n: 2 } });
  ok('the merge takes the larger of each, never the sum', merged.chef.xp === 800 && merged.chef.n === 40 && merged.barista.xp === 400);
  ok('...twice adds nothing', JSON.stringify(mergeMastery(merged, { chef: { xp: 300, n: 40 }, barista: { xp: 400, n: 2 } })) === JSON.stringify(merged));
  const forged = mergeMastery({}, Object.fromEntries(MASTERY_FIGHTERS.map((f) => [f, { xp: 99999, n: 99 }])));
  const sum = Object.values(forged).reduce((s, v) => s + v.xp, 0);
  ok(`a forged guest: each fighter capped at ${MASTERY_MERGE_MAX.fighter} (short of rank 5), the cast at ${MASTERY_MERGE_MAX.total}`, Object.values(forged).every((v) => v.xp <= MASTERY_MERGE_MAX.fighter && rankFor(v.xp).rank < 5) && sum <= MASTERY_MERGE_MAX.total);
}

// ---- pacing --------------------------------------------------------------------------------------------------------
{
  // an ordinary match: half won, a parry and an ender most matches, a punish or two
  const counts = [];
  for (let r = 1; r <= MAX_RANK; r++) {
    let c = C(), n = 0;
    while (rankFor(masteryOf(c, 'intern').xp).rank < r && n < 1000) {
      const w = payWithMastery(M({ fighter: 'intern', won: n % 2 === 0, parries: 1 + (n % 2), punishes: n % 3, enders: 1 }), c, `2026-01-${String(1 + (n % 28)).padStart(2, '0')}`);
      c = applyWithMastery(c, w, DAY); n++;
    }
    counts.push(n);
  }
  console.log(`      ordinary matches to reach mastery 1..5: ${counts.join(', ')}`);
  ok('rank 1 in a first session (5 matches or fewer, NEW HIRE helping)', counts[0] <= 5);
  ok('rank 2 (the taunt) in an evening or two', counts[1] <= 15);
  ok('rank 5 takes real time with one fighter (60 to 120 matches)', counts[4] >= 60 && counts[4] <= 120);
}

// ---- the real sim ----------------------------------------------------------------------------------------------
{
  const { createFighter, MOVES, MOVE_DATA } = await import('../../src/fighter/index.js');
  const { createArena } = await import('../../src/arena/index.js');
  const { createCombat } = await import('../../src/combat/sim.js');
  const { createInvariants } = await import('../../src/combat/invariants.js');
  const { EMPTY_INPUT } = await import('../../src/combat/input.js');
  const { roster } = await import('../../src/characters/index.js');
  const fighters = roster().map((c) => c.id);
  function makeSim(ids, kits, p1) {
    const arena = createArena('building'), sp = arena.spawns;
    const rigs = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
    let sim;
    const reads = { n: 0, inTaunt: 0 };
    const input = { snapshot: () => { reads.n++; if (sim && sim.units[0].state === 'taunt') reads.inTaunt++; return p1 ? p1() : EMPTY_INPUT; } };
    const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
    sim = createCombat({ fighters: rigs, arena, input, onEvent(ev) { if (sim.book) sim.book.event(ev); }, makeRig, moves: MOVES, moveData: MOVE_DATA });
    sim.setCharacters(ids, [], [], kits);
    return { sim, reads };
  }

  // a masher with every unlock on: mastery is still the base
  {
    let r = 7919, cur = EMPTY_INPUT, k = 0;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const masher = () => { if (k-- <= 0) { k = 1 + Math.floor(rnd() * 3); const b = Math.floor(rnd() * 4); cur = { ...EMPTY_INPUT, dx: rnd() < 0.7 ? 1 : 0, lp: b === 0, rp: b === 1, lk: b === 2, rk: b === 3 }; } else cur = { ...cur, lp: false, rp: false, lk: false, rk: false }; return cur; };
    const totals = [];
    for (const [i, id] of fighters.slice(0, 6).entries()) {
      const { sim } = makeSim([id, fighters[(i + 5) % fighters.length]], [{ pose: true, taunt: true }, {}], masher);
      sim.setHuman(0); sim.setAI(1, 0.55); sim.resetMatch({ seed: 11 + i, fresh: true });
      const closed = [];
      sim.book = createBook(sim, { send: () => {}, store: null, page: `m${i}`, onClose: (s) => closed.push(s) });
      sim.book.begin({ mode: 'arcade', level: 0.55, stage: 1, local: 0 });
      for (let t = 0; t < 120 * 240 && sim.phase !== 'match'; t++) sim.tick();
      sim.book.end();
      const w = payWithMastery({ ...closed[0], fighter: id }, C({ mastery: { [id]: { xp: 0, n: 9 } } }), DAY);
      totals.push(w.mastery ? [w.mastery.total, w.match.xp] : [0, -1]);
    }
    // a masher does land the odd counter hit or ender by luck (README, Daily shifts); what it never gets is pay for its hits
    ok('the real sim, a masher on P1 for 6 fighters (pose and taunt on): mastery is the career\'s match XP, a base and luck, no more',
      totals.every(([m, x]) => m === x && m < PAY.base.xp + 4 * PAY.enders.xp), totals.map(([m]) => m).join(', '));
  }

  // two CPUs, both with their taunt and pose on, short bars so rounds turn over: watch every step
  let taunts = 0, intoFight = 0, wrongWho = 0, inFight = 0, poses = 0, dances = 0, steps = 0, quiet = 0, violation = null, plainTaunts = 0;
  for (const [i, id] of fighters.entries()) {
    const opp = fighters[(i + 7) % fighters.length];
    for (const on of [true, false]) {
      const { sim, reads } = makeSim([id, opp], [{ pose: on, taunt: on }, { pose: on, taunt: on }]);
      sim.setAI(0, 0.9); sim.setAI(1, 0.5);
      sim.resetMatch({ seed: 22 + i, fresh: true, startHealth: 25 });
      const check = createInvariants(sim);
      let lastPhase = sim.phase, lastWinner = -1, sawTaunt = [false, false];
      for (let t = 0; t < 120 * 120 && !(sim.phase === 'match' && sim.phaseTimer < 0.2); t++) {
        if (sim.phase === 'ko') lastWinner = sim.winner;
        sim.tick(); steps++;
        violation = violation || check();
        for (const u of sim.units) {
          if (u.state !== 'taunt') continue;
          if (!on) plainTaunts++;
          if (sim.phase !== 'intro') inFight++;
          if (u.id !== lastWinner) wrongWho++;
          if (!sawTaunt[u.id]) { sawTaunt[u.id] = true; taunts++; }
        }
        if (lastPhase === 'intro' && sim.phase === 'fight' && sim.units.some((u) => u.state === 'taunt')) intoFight++;
        if (sim.phase === 'fight') sawTaunt = [false, false];
        lastPhase = sim.phase;
      }
      if (sim.phase === 'match' && sim.winner >= 0) {
        const w = sim.units[sim.winner];
        if (w.state === 'celebrate') { if (on && w.rig.current.move === w.char.victory) poses++; else if (!on && w.rig.current.move === w.char.dance) dances++; }
      }
      quiet += reads.inTaunt;
    }
  }
  console.log(`      ${steps} steps, ${taunts} taunts, ${poses} victory poses, ${dances} dances`);
  ok('the last round\'s winner taunts under the ROUND card (taunts seen)', taunts >= fighters.length);
  ok('...only the round\'s winner', wrongWho === 0, `${wrongWho}`);
  ok('...only while the ROUND card is up: never a step of it in the fight', inFight === 0 && intoFight === 0, `${inFight} steps in a fight, ${intoFight} into one`);
  ok('...and the taunting player\'s controls aren\'t read while it plays', quiet === 0, `${quiet}`);
  ok('no taunt without it unlocked and on', plainTaunts === 0);
  ok('a match won with the pose on ends in the victory pose; off, the usual dance', poses >= fighters.length * 0.6 && dances >= fighters.length * 0.6, `${poses} poses, ${dances} dances of ${fighters.length} each`);
  ok('the invariants (src/combat/invariants.js) hold on every step', !violation, violation ? JSON.stringify(violation) : '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
