#!/usr/bin/env node
// Stat upgrades (README, Progression, Stat upgrades): `npm run test:upgrades`. No browser, about 20 s:
//   - the prices and tiers: fixed, rising, shown up front; keys, order, what's ownable
//   - the effects, on paper (boostFor) and in the real sim: max health, a hit's damage, stamina regen, walk speed,
//     and nothing at all for a fighter with no upgrades (the same state hash as before)
//   - the EVEN room rule: cleanRules carries it and nothing else turns it on; FULL is every stat's top tier
//   - --balance: the arcade's first stages for a fully upgraded fighter against an unupgraded one (CPU stand-ins for
//     the player), the numbers the README quotes. Off by default (about a minute more).
import { STATS, PRICES, MAX_TIER, FULL, upKey, isUpgradeKey, levelOf, levelsOf, nextTier, canBuy, pctOf, boostFor, upgraded, tiersOwned } from '../../src/career/upgrades.js';
import { isOwnable, MASTERY_FIGHTERS } from '../../src/career/mastery.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ---- prices and tiers ------------------------------------------------------------------------------------------
{
  ok('four stats: HEALTH, POWER, STAMINA, FOOTWORK', STATS.map((s) => s.name).join() === 'HEALTH,POWER,STAMINA,FOOTWORK');
  ok('three tiers each, priced 100, 250, 500 sticks (rising, fixed)', MAX_TIER === 3 && PRICES.join() === '100,250,500' && PRICES.every((p, i) => i === 0 || p > PRICES[i - 1]));
  ok('a fighter\'s whole set costs 3,400 sticks', STATS.length * PRICES.reduce((a, b) => a + b, 0) === 3400);
  ok('modest: the top tier adds 10 to 15% to its stat', STATS.every((s) => s.pct.length === MAX_TIER && s.pct[MAX_TIER - 1] >= 10 && s.pct[MAX_TIER - 1] <= 15 && s.pct.every((p, i) => i === 0 || p > s.pct[i - 1])));
  ok('upKey and isUpgradeKey: barista:up:health:2', upKey('barista', 'health', 2) === 'barista:up:health:2' && isUpgradeKey('barista:up:health:2'));
  ok('isUpgradeKey: no tier 0 or 4, no unknown stat, no extra parts', !isUpgradeKey('barista:up:health:0') && !isUpgradeKey('barista:up:health:4') && !isUpgradeKey('barista:up:luck:1') && !isUpgradeKey('barista:up:health:1:x') && !isUpgradeKey(7));
  ok('isOwnable (what career.owned may hold): a known fighter\'s tier, not a stranger\'s', isOwnable('barista:up:power:3') && !isOwnable('nobody:up:power:1') && !isOwnable('barista:up:power:9'));
  const owned = [upKey('chef', 'health', 1), upKey('chef', 'health', 2), upKey('chef', 'power', 2), upKey('chef', 'stamina', 1)];
  ok('levels count tiers in order only (power 2 without 1 is 0)', levelOf(owned, 'chef', 'health') === 2 && levelOf(owned, 'chef', 'power') === 0 && levelOf(owned, 'chef', 'stamina') === 1 && levelOf(owned, 'barista', 'health') === 0);
  ok('levelsOf: every stat, in order', JSON.stringify(levelsOf(owned, 'chef')) === '{"health":2,"power":0,"stamina":1,"speed":0}');
  ok('nextTier: the next one at its price, null at the top', nextTier(owned, 'chef', 'health').tier === 3 && nextTier(owned, 'chef', 'health').price === 500 && nextTier(owned, 'chef', 'speed').price === 100
    && nextTier([1, 2, 3].map((t) => upKey('chef', 'speed', t)), 'chef', 'speed') === null && nextTier(owned, 'chef', 'luck') === null);
  ok('canBuy: in order only', canBuy(owned, 'chef', 'health', 3) === 'ok' && canBuy(owned, 'chef', 'health', 2) === 'owned' && canBuy(owned, 'chef', 'speed', 2) === 'order' && canBuy(owned, 'chef', 'speed', 4) === 'unknown' && canBuy(owned, 'chef', 'luck', 1) === 'unknown');
}

// ---- the effects on paper ----------------------------------------------------------------------------------------
{
  ok('nothing owned: no boost at all (null)', boostFor({ health: 0, power: 0, stamina: 0, speed: 0 }) === null && boostFor(null) === null && !upgraded({}));
  const b = boostFor(FULL);
  ok('FULL: +12% health, +12% power, +15% stamina regen, +10% walk and run', near(b.hp, 1.12) && near(b.dmg, 1.12) && near(b.regen, 1.15) && near(b.walk, 1.10), JSON.stringify(b));
  const one = boostFor({ health: 1, power: 0, stamina: 2, speed: 0 });
  ok('a mix: each stat its own tier, the rest 1', near(one.hp, 1.04) && one.dmg === 1 && near(one.regen, 1.10) && one.walk === 1);
  ok('tiersOwned counts the 12; FULL is all of them', tiersOwned(FULL) === 12 && tiersOwned({ health: 1, power: 2 }) === 3);
  ok('pctOf: the table', pctOf('health', 3) === 12 && pctOf('speed', 1) === 3 && pctOf('health', 0) === 0);
}

// ---- the room rule ---------------------------------------------------------------------------------------------
const { installDom } = await import('../netsim/env.mjs'); installDom();
{
  const { cleanRules } = await import('../../src/net/online.js');
  const { cleanSetup } = await import('../../src/net/watchlog.js');
  ok('cleanRules: OFF unless the host said EVEN (junk is OFF)', cleanRules(null).upgrades === 'off' && cleanRules({ upgrades: 'even' }).upgrades === 'even' && cleanRules({ upgrades: 'full' }).upgrades === 'off' && cleanRules({ upgrades: true }).upgrades === 'off');
  const st = cleanSetup({ n: 1, v: 26, seed: 1, chars: ['temp', 'chef'], rules: { roundTime: 60, winsNeeded: 2, upgrades: 'even' } });
  ok('spectators get it in the setup', st && st.rules.upgrades === 'even' && cleanSetup({ n: 1, v: 26, seed: 1, chars: [], rules: {} }).rules.upgrades === 'off');
}

// ---- the real sim ------------------------------------------------------------------------------------------------
const { createArena } = await import('../../src/arena/index.js');
const { createCombat } = await import('../../src/combat/sim.js');
const { EMPTY_INPUT } = await import('../../src/combat/input.js');
const { createFighter, MOVES, MOVE_DATA } = await import('../../src/fighter/index.js');
const { hashSim } = await import('../../src/net/hash.js');
const { LADDER, upgradeLift } = await import('../../src/flow/ladder.js');
function makeSim(ids, boosts = [], p1 = null) {
  const arena = createArena('building'), sp = arena.spawns;
  const rigs = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
  let sim;
  const input = { snapshot: () => (p1 ? p1(sim) : EMPTY_INPUT) };
  const makeRig = (c) => { const g = sim.units[0]; return createFighter({ color: c, x: g.x, y: g.y, facing: -1 }); };
  sim = createCombat({ fighters: rigs, arena, input, onEvent() {}, makeRig, moves: MOVES, moveData: MOVE_DATA });
  sim.setCharacters(ids, [], [], [], boosts);
  return sim;
}
const FULLB = boostFor(FULL);
{
  // max health
  const a = makeSim(['chef', 'temp']), b = makeSim(['chef', 'temp'], [FULLB]);
  a.resetMatch({ seed: 3, fresh: true }); b.resetMatch({ seed: 3, fresh: true });
  const ch = a.units[0].maxHealth;
  ok('HEALTH: max health ×1.12 at the top tier (rounded)', b.units[0].maxHealth === Math.round(a.startHealth * a.units[0].char.stats.health * 1.12 / 100), `${ch} -> ${b.units[0].maxHealth}`);
  ok('...and only the boosted fighter', a.units[1].maxHealth === b.units[1].maxHealth);

  // no boost: exactly the sim it was (two sims step for step, hashes equal)
  const c = makeSim(['barista', 'lawyer']), d = makeSim(['barista', 'lawyer'], [null, null]);
  for (const s of [c, d]) { s.setAI(0, 0.7); s.setAI(1, 0.7); s.resetMatch({ seed: 9, fresh: true }); }
  let same = true;
  for (let t = 0; t < 120 * 20; t++) { c.tick(); d.tick(); if (t % 120 === 0 && hashSim(c) !== hashSim(d)) { same = false; break; } }
  ok('no upgrades: 20 s of CPU play hash the same as a sim never told about them', same && c.units[0].upHp === 1 && c.units[0].upDmg === 1);

  // POWER and STAMINA and FOOTWORK, measured by stepping scripted fighters
  const hold = (inp) => () => inp;
  // walk speed: hold right for one second
  const w0 = makeSim(['temp', 'temp'], [], hold({ ...EMPTY_INPUT, dx: 1 })), w1 = makeSim(['temp', 'temp'], [FULLB], hold({ ...EMPTY_INPUT, dx: 1 }));
  for (const s of [w0, w1]) { s.setHuman(0); s.setController(1, 'none'); s.resetMatch({ seed: 1, skipIntro: true }); }
  const x0 = [w0.units[0].x, w1.units[0].x];
  for (let t = 0; t < 60; t++) { w0.tick(); w1.tick(); }
  const d0 = w0.units[0].x - x0[0], d1 = w1.units[0].x - x0[1];
  ok('FOOTWORK: a second\'s walk goes about 10% further', d0 > 20 && near(d1 / d0, 1.10, 0.02), `${d0.toFixed(1)} px -> ${d1.toFixed(1)} px`);
  // stamina regen: drain both bars to half, then stand still
  const r0 = makeSim(['temp', 'temp']), r1 = makeSim(['temp', 'temp'], [FULLB]);
  for (const s of [r0, r1]) { s.setController(0, 'none'); s.setController(1, 'none'); s.resetMatch({ seed: 1, skipIntro: true }); s.units[0].stamina = s.units[0].staminaMax / 2; s.units[0].regenAt = 0; }
  const s0 = [r0.units[0].stamina, r1.units[0].stamina];
  for (let t = 0; t < 30; t++) { r0.tick(); r1.tick(); }
  const g0 = r0.units[0].stamina - s0[0], g1 = r1.units[0].stamina - s0[1];
  ok('STAMINA: the bar comes back 15% faster', g0 > 0 && near(g1 / g0, 1.15, 0.01), `${g0.toFixed(2)} -> ${g1.toFixed(2)} in 0.25 s`);
  // power: the same jab on a standing dummy, unboosted and boosted
  const jab = (s) => { let k = 0; return () => (k++ === 4 ? { ...EMPTY_INPUT, lp: true } : EMPTY_INPUT); };
  const p0 = makeSim(['temp', 'temp'], [], jab()), p1 = makeSim(['temp', 'temp'], [FULLB], jab());
  for (const s of [p0, p1]) { s.setHuman(0); s.setController(1, 'none'); s.resetMatch({ seed: 1, skipIntro: true }); s.units[1].x = s.units[0].x + 60; }
  for (let t = 0; t < 120; t++) { p0.tick(); p1.tick(); }
  const h0 = p0.units[1].maxHealth - p0.units[1].health, h1 = p1.units[1].maxHealth - p1.units[1].health;
  ok('POWER: a jab does 12% more (rounded to the point)', h0 > 0 && h1 > h0 && Math.abs(h1 - h0 * 1.12) <= 1, `${h0} -> ${h1}`);
}

// ---- the arcade's first stages: --balance ---------------------------------------------------------------------------
// A CPU stands in for the player (0.35: a newer player who can win stage 1; 0.55: one who's past it), a stage's CPU at
// its ladder difficulty and style. Each pairing is played plain, fully upgraded, and fully upgraded against the CPU
// lifted the way the arcade lifts it (src/flow/ladder.js upgradeLift), on the same seeds: match wins and round wins.
if (process.argv.includes('--balance')) {
  const fighters = MASTERY_FIGHTERS.filter((f) => f !== 'ceo').slice(0, 6);
  const out = [];
  for (const lvl of [0.35, 0.55]) {
    for (const st of LADDER.slice(0, 3)) {
      for (const [boosted, lift] of [[false, false], [true, false], [true, true]]) {
        let won = 0, n = 0, rw = 0, rl = 0, secs = 0;
        for (const [i, f] of fighters.entries()) for (const seed of [1, 2, 3]) {
          const s = makeSim([f === st.char ? 'accountant' : f, st.char], [boosted ? FULLB : null, null]);
          s.setAI(0, lvl); s.setAI(1, lift ? upgradeLift(st.difficulty, 12) : st.difficulty, { style: st.style || undefined });
          s.resetMatch({ seed: seed * 31 + i, fresh: true });
          let steps = 0;
          for (; steps < 120 * 400 && s.phase !== 'match'; steps++) s.tick();
          n++; secs += steps / 120; if (s.winner === 0) won++; rw += s.wins[0]; rl += s.wins[1];
        }
        out.push({ lvl, stage: st.n, boosted, lift, won, n, rw, rl, secs: secs / n });
      }
    }
  }
  console.log('\n      player CPU  stage  upgrades       stage CPU   matches won  rounds  match length');
  for (const r of out) {
    const st = LADDER[r.stage - 1], cpu = r.lift ? upgradeLift(st.difficulty, 12) : st.difficulty;
    console.log(`      ${r.lvl.toFixed(2)}        ${r.stage}      ${r.boosted ? (r.lift ? 'FULL + lift' : 'FULL       ') : 'none       '}    ${cpu.toFixed(2)}        ${String(r.won).padStart(2)} / ${r.n}      ${String(r.rw).padStart(2)}-${String(r.rl).padEnd(2)}   ${r.secs.toFixed(0)} s`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
