// What the spectator upload costs the host's page (README, Multiplayer, Spectators, On the host): the real host
// feed (src/net/watchfeed.js) fed by a stand-in netcode that confirms two frames a tick, the way a 60 fps host
// running the 120 Hz sim does, for five minutes of a watched match on a virtual clock. The work is timed with the
// real clock, each tick on its own, so the frames that send show up at the top percentiles.
//
//   node scripts/watch/feedcost.mjs [minutes]

import { createWatchFeed, UPLOAD_MS } from '../../src/net/watchfeed.js';
import { performance } from 'node:perf_hooks';

const MIN = +(process.argv[2] || 5), FPS = 60, TICKS = MIN * 60 * FPS;
let clock = 0;
const feed = createWatchFeed({ now: () => clock, version: 1 });
let sent = 0, bytes = 0;
feed.open((d) => { sent++; bytes += typeof d === 'string' ? d.length : d.byteLength; }, { on: true });
const ls = { confirmed: -1, hashes: new Map(), input: (i, f) => (f * 7 + i * 3) & 2047 };
const sim = { round: 1, wins: [0, 0] };
feed.begin({ n: 1, seed: 1, chars: ['intern', 'temp'], pals: null, botch: true, rules: {}, names: ['A', 'B'], tally: [0, 0] }, ls);
feed.onWatching({ n: 1, have: 1, need: 0 });
sent = bytes = 0;
const per = new Float64Array(TICKS);
for (let i = 0; i < TICKS; i++) {
  clock += 1000 / FPS;
  ls.confirmed += 2;
  if ((ls.confirmed + 1) % 30 < 2) ls.hashes.set(ls.confirmed - ((ls.confirmed + 1) % 30), 'deadbeef');
  const t0 = performance.now();
  feed.tick(sim);
  per[i] = performance.now() - t0;
}
const sorted = Float64Array.from(per).sort();
const pct = (p) => (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100))] * 1000).toFixed(1);
const avg = per.reduce((a, b) => a + b, 0) / TICKS * 1000;
const sec = MIN * 60;
console.log(`UPLOAD_MS ${UPLOAD_MS}: ${TICKS} frames at ${FPS} fps, ${MIN} min. ${avg.toFixed(2)} µs a frame on average, ${pct(50)} median, ${pct(99)} at the 99th, ${pct(100)} worst. ` +
  `${sent} messages (${(sent / sec).toFixed(1)} a second), ${bytes} bytes (${(bytes / sec).toFixed(0)} a second, ${(bytes / Math.max(1, sent)).toFixed(0)} a message)`);
