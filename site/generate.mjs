#!/usr/bin/env node
// Writes the site's generated pages from the character data (README, "Site"):
//   fighters/index.html          the roster index
//   fighters/<id>/index.html     one page per registered character
//   how-to-play/[philosophy/|strategy/]index.html   the How to Play pages (site/guide.mjs)
//   .site/home.json              the homepage's fills: the cast grid, the fighter
//                                and ladder counts (site/vite-plugin.mjs puts each in its <!--@key--> marker)
//   public/sprites/<id>-idle[-2x].webp   the roster cards' idle loops (site/sprites.mjs)
// All of these are build products (gitignored). vite.config.ts runs this in a fresh Node process before
// every build and dev start, and again in dev when a character file changes, so the registry is always
// imported fresh. Run it by hand with `node site/generate.mjs`.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSheets } from './data.mjs';
import { fighterPage, rosterPage, rosterCards } from './templates.mjs';
import { FIGHT, MENUS, FACE, PILL } from '../src/flow/controls.js';
import { LADDER } from '../src/flow/ladder.js';
import { writeSprites } from './sprites.mjs';
import { rulesPage, philosophyPage, strategyPage } from './guide.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'fighters');

const sheets = allSheets();
// rewrite in place and drop only folders whose character is gone, so a build reading the pages while the
// dev server regenerates them never finds the folder missing
mkdirSync(OUT, { recursive: true });
for (const d of readdirSync(OUT, { withFileTypes: true })) if (d.isDirectory() && !sheets.some((s) => s.id === d.name)) rmSync(join(OUT, d.name), { recursive: true, force: true });
writeFileSync(join(OUT, 'index.html'), rosterPage(sheets));
sheets.forEach((s, i) => {
  mkdirSync(join(OUT, s.id), { recursive: true });
  writeFileSync(join(OUT, s.id, 'index.html'), fighterPage(s, i, sheets));
});
// the How to Play pages (site/guide.mjs)
const GUIDE = join(ROOT, 'how-to-play');
for (const [dir, html] of [['', rulesPage({ FIGHT, MENUS, FACE, PILL })], ['philosophy', philosophyPage()], ['strategy', strategyPage()]]) {
  mkdirSync(join(GUIDE, dir), { recursive: true });
  writeFileSync(join(GUIDE, dir, 'index.html'), html);
}
mkdirSync(join(ROOT, '.site'), { recursive: true });
writeFileSync(join(ROOT, '.site', 'home.json'), JSON.stringify({
  count: String(sheets.length),
  stages: String(LADDER.length),
  roster: rosterCards(sheets, './fighters/', { cast: true }),
}) + '\n');
// the roster cards' idle loops, drawn with the real rig (site/sprites.mjs); a fighter that can't be drawn fails the build
const sprites = writeSprites(sheets, join(ROOT, 'public', 'sprites'));
console.log(`[site] ${sheets.length} fighter pages, ${sprites} sprite sheets`);
