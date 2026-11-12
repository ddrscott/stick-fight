#!/usr/bin/env node
// The Supply Closet, the math (README, Progression, The Supply Closet): `npm run test:closet`. No browser:
//   - itemsFor: MAIN first, then each shelf in KINDS order, cheapest first; extras (mastery items) join their shelf
//   - unlockText: '150 STICKS', 'BARISTA MASTERY 3', both joined with OR
//   - stateOf: main, owned, buy, short, rank; a mastery item unlocks at its rank, a priced one by buying
//   - completion: per fighter and overall, MAIN not counted, mastery unlocks counted
import { itemsFor, unlockText, stateOf, isOwned, completion, KINDS, EXTRAS } from '../../src/career/catalog.js';
import { PALETTES, palettesFor, itemKey, masteryPalette } from '../../src/career/palettes.js';
import { masteryItems } from '../../src/career/mastery.js';
import { blankCareer } from '../../src/career/rules.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const fighters = Object.keys(PALETTES);
const C = (o = {}) => ({ ...blankCareer(), ...o });

// ---- itemsFor -----------------------------------------------------------------------------------------------------
{
  const list = itemsFor('barista', []);   // the sold palettes alone; fighter mastery's extras are checked below
  ok('MAIN comes first and is the only main', list[0].main && list[0].name === 'MAIN' && list.filter((i) => i.main).length === 1);
  ok('then every palette, cheapest first', list.slice(1).map((i) => i.id).join() === palettesFor('barista').slice().sort((a, b) => a.price - b.price).map((p) => p.id).join());
  ok('each palette carries its key and look', list.slice(1).every((i) => i.key === itemKey('barista', i.id) && i.look && i.look.body));
  ok('fighter mastery ships three extras a fighter: the mastery palette, the pose, the taunt', EXTRAS.length === fighters.length * 3
    && fighters.every((f) => EXTRAS.filter((x) => x.fighter === f).map((x) => x.kind).sort().join() === 'palette,pose,taunt'));
  const real = itemsFor('barista');
  ok('the real shelf: MAIN, three sold palettes, the mastery palette, then the pose and the taunt', real.slice(1).map((i) => i.kind).join() === 'palette,palette,palette,palette,pose,taunt'
    && real[4].id === masteryPalette('barista').id && !real[4].price && real[4].mastery === 5);
  ok('sold palettes carry the rank that unlocks them early (1 and 3; the dearest at 5)', real.slice(1, 4).map((i) => i.mastery).join() === '1,3,5' && real.slice(1, 4).every((i) => i.price));
  ok('the shelves are palettes, poses, taunts, plates, banners', KINDS.map((k) => k.kind).join() === 'palette,pose,taunt,plate,banner');
  const extras = [
    { fighter: 'barista', kind: 'taunt', id: 'refill', name: 'REFILL', mastery: 2 },
    { fighter: 'barista', kind: 'pose', id: 'latteArt', name: 'LATTE ART', mastery: 3 },
    { fighter: 'barista', kind: 'palette', id: 'oat', name: 'OAT MILK', price: 450, mastery: 2 },
    { fighter: 'chef', kind: 'pose', id: 'flambe', name: 'FLAMBE', mastery: 1 },
    { fighter: 'barista', kind: 'hat', id: 'nope', name: 'NOT A SHELF', price: 1 },
  ];
  const more = itemsFor('barista', extras);
  ok('extras join their own fighter only, on a known shelf', more.length === list.length + 3 && !more.some((i) => i.id === 'flambe' || i.id === 'nope'));
  ok('shelves stay in KINDS order: palettes, poses, taunts', more.slice(1).map((i) => i.kind).join() === 'palette,palette,palette,palette,pose,taunt');
  ok('a priced extra palette sorts by price among the palettes', more.slice(1, 5).map((i) => i.price).join() === '150,300,450,600');
  ok('a non-palette extra gets a kind-scoped key', more.find((i) => i.id === 'refill').key === 'barista:taunt:refill');
}

// ---- unlockText ---------------------------------------------------------------------------------------------------
{
  ok('a price reads 250 STICKS', unlockText({ price: 250 }, 'BARISTA') === '250 STICKS');
  ok('a big price gets a comma', unlockText({ price: 1200 }, 'BARISTA') === '1,200 STICKS');
  ok('a rank reads BARISTA MASTERY 3', unlockText({ mastery: 3 }, 'BARISTA') === 'BARISTA MASTERY 3');
  ok('both read 450 STICKS OR BARISTA MASTERY 2', unlockText({ price: 450, mastery: 2 }, 'BARISTA') === '450 STICKS OR BARISTA MASTERY 2');
}

// ---- stateOf: the locked states -----------------------------------------------------------------------------------
{
  const [main, cheap, mid] = itemsFor('barista', []);
  const rankOnly = { fighter: 'barista', kind: 'pose', id: 'latteArt', name: 'LATTE ART', key: 'barista:pose:latteArt', mastery: 3 };
  const both = { fighter: 'barista', kind: 'palette', id: 'oat', name: 'OAT', key: 'barista:oat', price: 450, mastery: 2 };
  ok('MAIN is main, broke or not', stateOf(main, C({ sticks: 0 })) === 'main');
  ok('short: priced, not enough sticks', stateOf(cheap, C({ sticks: cheap.price - 1 })) === 'short');
  ok('buy: priced, exactly enough sticks', stateOf(cheap, C({ sticks: cheap.price })) === 'buy');
  ok('owned once bought, whatever the sticks', stateOf(cheap, C({ sticks: 0, owned: [cheap.key] })) === 'owned');
  ok('owning one palette leaves the next locked', stateOf(mid, C({ sticks: 0, owned: [cheap.key] })) === 'short');
  ok('rank: mastery only, rank not there yet', stateOf(rankOnly, C({ sticks: 99999 }), 2) === 'rank');
  ok('...unlocked at that rank', stateOf(rankOnly, C(), 3) === 'owned' && isOwned(rankOnly, C(), 4));
  ok('price or rank: buyable before the rank', stateOf(both, C({ sticks: 500 }), 1) === 'buy');
  ok('price or rank: the rank unlocks it with no sticks', stateOf(both, C({ sticks: 0 }), 2) === 'owned');
  ok('a missing career reads as broke, not a crash', stateOf(cheap, null) === 'short');
}

// ---- completion ---------------------------------------------------------------------------------------------------
{
  const total = fighters.reduce((n, f) => n + palettesFor(f).length + masteryItems(f).length, 0);
  const none = completion(C(), fighters);
  ok(`a new player has 0 of ${total}, MAIN not counted`, none.have === 0 && none.total === total);
  ok('each fighter counts its own palettes and mastery items', fighters.every((f) => none.per[f].total === palettesFor(f).length + 3 && none.per[f].have === 0));
  const two = completion(C({ owned: [itemKey('barista', 'matcha'), itemKey('chef', palettesFor('chef')[0].id), 'barista:bogus'] }), fighters);
  ok('two bought: 2 overall, 1 each for barista and chef, a stale key ignored', two.have === 2 && two.per.barista.have === 1 && two.per.chef.have === 1);
  const extras = [{ fighter: 'barista', kind: 'pose', id: 'latteArt', name: 'LATTE ART', mastery: 3 }];
  const sold = fighters.reduce((n, f) => n + palettesFor(f).length, 0);
  const ranked = completion(C(), fighters, { extras, ranks: { barista: 3 } });
  // rank 3 also unlocks the two sold palettes that come early at 1 and 3
  ok('a mastery item counts in the total and, at its rank, in what you have', ranked.total === sold + 1 && ranked.per.barista.have === 3 && ranked.per.barista.total === palettesFor('barista').length + 1);
  const all = completion(C(), ['barista'], { ranks: { barista: 5 } });
  ok('a fighter with everything reads have === total', all.per.barista.have === all.per.barista.total && all.have === all.total);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
