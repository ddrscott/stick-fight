// What a shared link looks like in a chat: a mock iMessage bubble and a Slack-style unfurl for each link,
// built from the tags and images the local Worker serves (README, Site, Share image).
//
//   node scripts/og/mock.mjs <base> <out dir> <play/ query>...
//   node scripts/og/mock.mjs http://127.0.0.1:8787/stick-fight/ gauntlet/tmp/og-mock '?crew=lunch-crew-abcde' '?room=K7QM' ''
//
// Writes <out>/mock.html (the images saved beside it) and <out>/mock.png, a screenshot of the page.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, executablePath } from '../../gauntlet/browser.mjs';

const [base, out, ...queries] = process.argv.slice(2);
if (!base || !out || !queries.length) { console.error('usage: node scripts/og/mock.mjs <base> <out dir> <query>...'); process.exit(2); }
const BASE = base.replace(/\/?$/, '/');
fs.mkdirSync(out, { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const ua = 'facebookexternalhit/1.1 Facebot Twitterbot/1.0';

const cards = [];
for (const [i, q] of queries.entries()) {
  const html = await (await fetch(`${BASE}play/${q}`, { headers: { 'user-agent': ua } })).text();
  const t = Object.fromEntries([...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')]));
  const img = await fetch(t['og:image'].replace(/^https:\/\/askscottpierce\.com\/stick-fight\//, BASE.replace(/\/stick-fight\/$/, '/stick-fight/')));
  const file = `img-${i}${t['og:image'].endsWith('.jpg') ? '.jpg' : path.extname(new URL(t['og:image']).pathname) || '.jpg'}`;
  fs.writeFileSync(path.join(out, file), new Uint8Array(await img.arrayBuffer()));
  cards.push({ q: q || '(plain play/)', file, t, link: t['og:url'] });
}

const page = `<!doctype html><meta charset="utf-8"><title>Share previews</title>
<style>
  body { margin: 0; padding: 28px; background: #e9e9ee; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #111; }
  h1 { font: 600 13px/1 ui-monospace, Menlo, monospace; letter-spacing: .08em; margin: 0 0 18px; color: #555; }
  .row { display: grid; grid-template-columns: 160px 330px 520px; gap: 26px; align-items: start; margin-bottom: 26px; }
  .q { font: 12px/1.4 ui-monospace, Menlo, monospace; color: #444; word-break: break-all; padding-top: 6px; }
  .im { background: #fff; border-radius: 18px; overflow: hidden; width: 300px; box-shadow: 0 1px 2px rgba(0,0,0,.12); margin-left: auto; }
  .im img { display: block; width: 100%; aspect-ratio: 1200/630; object-fit: cover; }
  .im .cap { background: #e5e5ea; padding: 9px 12px 10px; }
  .im .t { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .im .d { color: #6c6c70; font-size: 13px; }
  .sl { background: #fff; padding: 12px 14px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .sl .msg { margin-bottom: 6px; color: #1264a3; font-size: 14px; word-break: break-all; }
  .sl .un { border-left: 4px solid #ddd; padding-left: 12px; }
  .sl .site { font-weight: 700; font-size: 13px; }
  .sl .t { color: #1264a3; font-weight: 700; font-size: 15px; margin: 2px 0; }
  .sl .d { font-size: 14px; color: #1d1c1d; margin-bottom: 8px; }
  .sl img { width: 360px; border-radius: 8px; display: block; }
  .lab { font: 600 11px/1 ui-monospace, Menlo, monospace; color: #888; letter-spacing: .1em; margin-bottom: 6px; }
</style>
<h1>SHARE PREVIEWS · mock iMessage (cut at one line) and Slack unfurls, from the local Worker's tags</h1>
${cards.map((c) => `<div class="row">
  <div class="q">${esc(c.q)}</div>
  <div><div class="lab">IMESSAGE</div><div class="im"><img src="${c.file}"><div class="cap"><div class="t">${esc(c.t['og:title'])}</div><div class="d">askscottpierce.com</div></div></div></div>
  <div><div class="lab">SLACK</div><div class="sl"><div class="msg">${esc(c.link)}</div><div class="un"><div class="site">${esc(c.t['og:site_name'])}</div><div class="t">${esc(c.t['og:title'])}</div><div class="d">${esc(c.t['og:description'])}</div><img src="${c.file}"></div></div></div>
</div>`).join('\n')}`;
fs.writeFileSync(path.join(out, 'mock.html'), page);

const b = await chromium.launch({ executablePath });
const p = await b.newPage({ viewport: { width: 1140, height: 400 }, deviceScaleFactor: 1 });
await p.goto('file://' + path.resolve(out, 'mock.html'));
await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
await p.screenshot({ path: path.join(out, 'mock.png'), fullPage: true });
await b.close();
console.log(`wrote ${path.join(out, 'mock.html')} and mock.png (${cards.length} links)`);
