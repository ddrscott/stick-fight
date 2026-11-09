#!/usr/bin/env node
// Writes the site's generated pages from the character data (README, "Site"):
//   fighters/index.html          the roster index
//   fighters/<id>/index.html     one page per registered character
//   .site/home.json              the homepage's roster grid and fighter count (vite.config.ts injects it)
// Both folders are build products (gitignored). vite.config.ts runs this in a fresh Node process before
// every build and dev start, and again in dev when a character file changes, so the registry is always
// imported fresh. Run it by hand with `node site/generate.mjs`.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSheets } from './data.mjs';
import { fighterPage, rosterPage, rosterCards } from './templates.mjs';

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
writeFileSync(join(ROOT, '.site', 'home.json'), JSON.stringify({ count: sheets.length, cards: rosterCards(sheets, './fighters/') }) + '\n');
console.log(`[site] ${sheets.length} fighter pages`);
