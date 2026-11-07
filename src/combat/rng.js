// Seeded PRNG so AI fights and camera shake replay identically from a seed.
// rng.state reads and writes the generator's whole state (one uint32), so online rollback can
// save and restore it with the rest of the sim.
export function mulberry32(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(rng, 'state', { get: () => a, set: (v) => { a = v >>> 0; } });
  return rng;
}
