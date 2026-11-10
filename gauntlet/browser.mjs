// Playwright and a headless browser for the capture tools, found without setup.
//
// The tools use whatever playwright is around: a local install, else the global one (npm root -g),
// else the one beside this node. A global playwright often wants a browser build that was never
// downloaded (1.61 wants headless shell 1208 while the cache holds 1228 and 1248), so the browser is:
//   1. PW_CHROME, when set
//   2. the build this playwright wants, when it's downloaded
//   3. else the newest chromium_headless_shell-* already in the playwright cache (macOS or Linux)
// Pass `executablePath` to chromium.launch(); undefined lets playwright report its own error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  const roots = [];
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch {}
  roots.push(path.join(path.dirname(process.execPath), '../lib/node_modules'));
  for (const r of roots) {
    const p = path.join(r, 'playwright');
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error('playwright not found: npm i -g playwright (or install it locally)');
}

export const playwright = loadPlaywright();
export const { chromium } = playwright;

function findBrowser() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  try { if (fs.existsSync(chromium.executablePath())) return undefined; } catch {}
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')];
  for (const dir of caches) {
    if (!dir || !fs.existsSync(dir)) continue;
    const builds = fs.readdirSync(dir).filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
    for (const b of builds) {
      for (const plat of fs.readdirSync(path.join(dir, b))) {
        const exe = path.join(dir, b, plat, 'chrome-headless-shell');
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

export const executablePath = findBrowser();
