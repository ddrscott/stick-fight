#!/usr/bin/env node
// Writes the site's generated pages from the character data (README, "Site"):
//   fighters/index.html          the roster index
//   fighters/<id>/index.html     one page per registered character
//   .site/home.json              the homepage's fills: the cast grid, the controls table, the fighter
//                                and ladder counts (site/vite-plugin.mjs puts each in its <!--@key--> marker)
//   public/sprites/<id>-idle[@2x].webp   the roster cards' idle loops (site/sprites.mjs)
// All three are build products (gitignored). vite.config.ts runs this in a fresh Node process before
// every build and dev start, and again in dev when a character file changes, so the registry is always
// imported fresh. Run it by hand with `node site/generate.mjs`.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSheets } from './data.mjs';
import { fighterPage, rosterPage, rosterCards, controlsTable } from './templates.mjs';
import { FIGHT, MENUS, FACE, PILL } from '../src/flow/controls.js';
import { LADDER } from '../src/flow/ladder.js';
import { writeSprites } from './sprites.mjs';

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
mkdirSync(join(ROOT, '.site'), { recursive: true });
writeFileSync(join(ROOT, '.site', 'home.json'), JSON.stringify({
  count: String(sheets.length),
  stages: String(LADDER.length),
  roster: rosterCards(sheets, './fighters/', { cast: true }),
  controls: controlsTable(FIGHT, MENUS, FACE, PILL),
}) + '\n');
// the roster cards' idle loops, drawn with the real rig (site/sprites.mjs); a fighter that can't be drawn fails the build
const sprites = writeSprites(sheets, join(ROOT, 'public', 'sprites'));
console.log(`[site] ${sheets.length} fighter pages, ${sprites} sprite sheets`);
