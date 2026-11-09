// HTML for the generated pages (the roster index and one page per fighter) and the homepage's roster
// grid. Plain template strings, no framework. Every link and asset is relative to the page (`root` is
// the way back to /stick-fight/ from it), so the pages work at the subpath, on the dev server and in
// `vite preview`. Absolute URLs appear only where they have to: canonical and Open Graph tags.

export const SITE = 'https://askscottpierce.com/stick-fight/';
export const REPO = 'https://github.com/ddrscott/stick-fight';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1).toLowerCase();
const sign = (n) => (n > 0 ? `+${n}` : String(n));

export function head({ root, title, description, path, page }) {
  const url = SITE + path;
  return `<!doctype html>
<html lang="en" data-root="${root}" data-page="${esc(page)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Neon Stick Fight">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="32x32" href="${root}icons/favicon-32.png">
<link rel="apple-touch-icon" href="${root}icons/apple-touch-icon.png">
<meta name="theme-color" content="#07020f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee&family=Teko:wght@500;600&display=swap">
<link rel="stylesheet" href="${root}site/site.css">
<script defer data-domain="askscottpierce.com" src="https://plausible.ljs.app/js/script.hash.outbound-links.pageview-props.revenue.tagged-events.js"></script>
</head>`;
}

export function topbar(root) {
  return `<header class="s-top">
  <a class="s-logo" href="${root}"><span>NEON</span> STICK FIGHT</a>
  <nav class="s-nav">
    <a href="${root}fighters/">FIGHTERS</a>
    <a href="${root}#how">HOW TO PLAY</a>
    <a class="s-btn s-btn-play" href="${root}play/">PLAY</a>
  </nav>
</header>`;
}

export function footer(root) {
  return `<footer class="s-foot">
  <p><a class="s-logo" href="${root}"><span>NEON</span> STICK FIGHT</a></p>
  <p>Free and open source under the GNU AGPL v3. <a href="${REPO}">Source on GitHub</a> · <a href="${REPO}#license-and-credits">Credits</a></p>
  <p>Music runs on <a href="https://strudel.cc">Strudel</a> (AGPL-3.0, <a href="https://codeberg.org/uzu/strudel">source</a>). Fonts: Bungee and Teko (SIL OFL). Animation inspired by Xiao Xiao.</p>
  <p>A side project by <a href="https://askscottpierce.com/">Scott Pierce</a>.</p>
</footer>`;
}

const script = (root) => `<script type="module" src="${root}site/site.js"></script>`;

// ---- the roster grid (homepage and the roster index) ----------------------------------------------------
export function rosterCards(sheets, hrefPrefix, { detail = false } = {}) {
  return sheets.map((s) => {
    const hp = s.stats.find((x) => x.key === 'health');
    const uniques = s.moves.filter((m) => m.listed).map((m) => m.name);
    return `<a class="s-card" href="${hrefPrefix}${s.id}/" style="--c:${s.color}">
    <canvas class="s-rig" data-char="${s.id}" data-mode="idle" aria-hidden="true"></canvas>
    <b class="s-card-name${s.name.length > 10 ? ' s-long' : ''}">${esc(s.name)}</b>
    <small class="s-card-tag">${esc(cap(s.tagline))}</small>${detail ? `
    <span class="s-card-meta">${hp.value} HEALTH · ${uniques.length ? esc(uniques.join(' · ')) : 'EVERY SHARED MOVE'}</span>` : ''}
  </a>`;
  }).join('\n  ');
}

// ---- the roster index -------------------------------------------------------------------------------------
export function rosterPage(sheets) {
  const root = '../';
  return `${head({ root, title: 'Fighters · Neon Stick Fight', description: `All ${sheets.length} fighters in Neon Stick Fight, with their stats, unique moves, strings and frame data.`, path: 'fighters/', page: 'fighters' })}
<body class="s-page s-roster-page">
${topbar(root)}
<main class="s-main">
  <section class="s-section">
    <h1 class="s-h1">THE ROSTER</h1>
    <p class="s-lede">${sheets.length} office workers, one building. Every fighter keeps the shared basics (the four limbs, crouch and air attacks, throws) and brings their own stats, body, unique moves and strings. Pick one for the full move sheet.</p>
    <div class="s-grid s-grid-lg">
  ${rosterCards(sheets, './', { detail: true })}
    </div>
  </section>
</main>
${footer(root)}
${script(root)}
</body>
</html>
`;
}

// ---- one fighter --------------------------------------------------------------------------------------------
function swatch(label, color) {
  if (!color) return '';
  return `<li><i style="background:${color}"></i><span>${label}</span><code>${esc(color.toUpperCase())}</code></li>`;
}

function statBlock(st) {
  return `<div class="s-stat">
      <div class="s-stat-head"><span class="s-stat-label">${st.label}</span><span class="s-stat-value">${st.value}</span></div>
      <div class="s-bar" role="img" aria-label="${st.label} ${st.value}, ${esc(st.diffText)}"><i style="width:${(st.pos * 100).toFixed(1)}%"></i><em style="left:${(st.basePos * 100).toFixed(1)}%"></em></div>
      <div class="s-stat-foot"><span>${esc(st.help)}</span><span class="${st.diff > 0 ? 's-up' : st.diff < 0 ? 's-down' : ''}">${esc(st.diffText)}</span></div>
    </div>`;
}

function fd(label, value, title = '') {
  return `<div${title ? ` title="${esc(title)}"` : ''}><dt>${label}</dt><dd>${value == null || value === '' ? '—' : value}</dd></div>`;
}
const fmtF = (n) => (n == null ? null : `${n}f`);
const fmtBlock = (n) => (n == null ? null : `<span class="${n >= 0 ? 's-up' : n <= -10 ? 's-down' : ''}">${sign(n)}</span>`);

// the clips a card plays, in order: a string's presses before its ender, a stance before what comes out of it
function seqFor(s, card) { return card.seq && card.seq.length ? card.seq : [card.clip].filter(Boolean); }

function moveCard(s, card) {
  const r = card.row;
  const inputs = card.inputs.map((i) => `<span class="s-in">${esc(i.input)}</span>${i.how ? `<span class="s-how">${esc(i.how)}</span>` : ''}`).join('<span class="s-or">or</span>');
  const feints = card.feints.map((f) => `<p class="s-also"><span class="s-in">${esc(f.input)}</span><span class="s-how">${esc(f.how)}: ${f.row.damage.text} damage, ${esc(f.row.height)}${f.row.props.filter((p) => !/^glides/.test(p)).map((p) => ', ' + esc(p)).join('')}</span></p>`).join('');
  return `<article class="s-move" id="move-${card.move}">
      <canvas class="s-rig s-move-rig" data-char="${s.id}" data-mode="move" data-seq="${esc(seqFor(s, card).join(','))}" aria-label="${esc(card.name)} animation"></canvas>
      <div class="s-move-body">
        <h3 class="s-h3">${esc(card.name)}</h3>
        <p class="s-inputs">${inputs}</p>
        <p class="s-desc">${esc(cap(card.note))}</p>
        <dl class="s-fd">
          ${fd('DAMAGE', r.damage.text)}
          ${fd('HEIGHT', r.height === '—' ? null : r.height.toUpperCase())}
          ${fd('STARTUP', fmtF(r.startup), 'frames from the press to contact, at 60 fps')}
          ${fd('ACTIVE', fmtF(r.active))}
          ${fd('RECOVERY', fmtF(r.recovery))}
          ${fd('ON BLOCK', fmtBlock(r.onBlock), 'frames of advantage when it is blocked; minus means the other fighter acts first')}
          ${fd('STAMINA', r.cost)}
          ${fd(r.reachKind === 'grab range' ? 'GRAB RANGE' : 'REACH', r.reach != null ? `${r.reach} px` : null)}
        </dl>
        ${r.props.length ? `<ul class="s-chips">${r.props.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        ${feints}
      </div>
    </article>`;
}

function basicsTable(s) {
  const rows = s.basics.map((b) => {
    const r = b.row;
    return `<tr${b.replacedBy ? ' class="s-replaced"' : ''}>
          <td><span class="s-in">${esc(b.input)}</span></td>
          <th scope="row">${esc(b.name)}${b.note ? `<small>${esc(b.note)}</small>` : ''}${b.replacedBy ? `<small class="s-rep">replaced by ${esc(b.replacedBy)}</small>` : ''}</th>
          <td>${r.damage.text}</td><td>${esc(r.height)}</td><td>${r.startup ?? '—'}</td><td>${r.onBlock == null ? '—' : fmtBlock(r.onBlock)}</td><td>${r.cost}</td><td>${r.reach ?? '—'}</td>
          <td class="s-props">${esc(r.props.join(', '))}</td>
        </tr>`;
  }).join('');
  return `<div class="s-table-wrap"><table class="s-table">
        <thead><tr><th>INPUT</th><th>MOVE</th><th>DMG</th><th>HEIGHT</th><th>STARTUP</th><th>ON BLOCK</th><th>STAMINA</th><th>REACH</th><th>PROPERTIES</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
}

function stringsTable(s) {
  const rows = s.strings.list.map((x) => `<tr${x.own ? ' class="s-own"' : ''}>
          <td><span class="s-in">${esc(x.input)}</span></td>
          <th scope="row">${esc(x.name)}${x.own ? '<small class="s-tag">UNIQUE</small>' : ''}</th>
          <td class="s-seq">${esc(x.moves.join(' › '))}</td>
          <td>${esc(x.payoff || '—')}</td><td>${x.damage}</td><td>${x.cost}</td>
        </tr>`).join('');
  return `<div class="s-table-wrap"><table class="s-table">
        <thead><tr><th>INPUT</th><th>STRING</th><th>HITS</th><th>PAYOFF</th><th>DMG</th><th>STAMINA</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
}

export function fighterPage(s, i, sheets) {
  const root = '../../';
  const prev = sheets[(i - 1 + sheets.length) % sheets.length], next = sheets[(i + 1) % sheets.length];
  const listed = s.moveList.map((m) => `<li><span class="s-in">${esc(m.input)}</span><b>${esc(m.name)}</b><span>${esc(m.note)}</span></li>`).join('');
  const uniqueNames = s.moves.filter((m) => m.listed).map((m) => m.name);
  const desc = `${s.name} in Neon Stick Fight: "${cap(s.tagline)}". Stats, body, ${uniqueNames.length ? `unique moves (${uniqueNames.join(', ')})` : 'the shared moves'}, strings and frame data.`;
  return `${head({ root, title: `${s.name} · Neon Stick Fight fighter`, description: desc, path: `fighters/${s.id}/`, page: `fighter:${s.id}` })}
<body class="s-page s-fighter" style="--c:${s.color};--p:${s.pants || s.color};--a:${s.accent}">
${topbar(root)}
<main class="s-main">
  <nav class="s-crumbs" aria-label="Fighters">
    <a href="../">ALL FIGHTERS</a>
    <span><a href="../${prev.id}/" rel="prev">‹ ${esc(prev.name)}</a><a href="../${next.id}/" rel="next">${esc(next.name)} ›</a></span>
  </nav>

  <section class="s-fhero">
    <div class="s-fstage"><canvas class="s-rig" data-char="${s.id}" data-mode="showcase" aria-label="${esc(s.name)} showing off"></canvas></div>
    <div class="s-fid">
      <p class="s-kicker">FIGHTER ${i + 1} OF ${sheets.length}</p>
      <h1 class="s-h1 s-fname">${esc(s.name)}</h1>
      <p class="s-tagline">${esc(cap(s.tagline))}</p>
      <ul class="s-swatches">
        ${swatch('BODY', s.color)}${swatch('PANTS', s.pants)}${swatch('ACCENT', s.accent)}${swatch('MIRROR', s.altColor)}${s.altPants ? swatch('MIRROR PANTS', s.altPants) : ''}
      </ul>
      ${listed ? `<ul class="s-sig">${listed}</ul>` : ''}
      <a class="s-btn s-btn-play s-btn-big" href="${root}play/?pick=${s.id}">PLAY AS ${esc(s.name)}</a>
    </div>
  </section>

  <section class="s-section" id="stats">
    <h2 class="s-h2">STATS</h2>
    <p class="s-note">Measured against TEMP, the baseline (the tick on each bar).</p>
    <div class="s-stats">
    ${s.stats.map(statBlock).join('\n    ')}
    </div>
  </section>

  <section class="s-section s-cols" id="body">
    <div>
      <h2 class="s-h2">BODY</h2>
      <dl class="s-kv">
        ${s.body.rows.map((r) => `<div><dt>${r.label}</dt><dd>${r.value}<small>${esc(r.note)}</small></dd></div>`).join('\n        ')}
      </dl>
      <h3 class="s-h3">REACH, ROOT TO FIST OR FOOT</h3>
      <dl class="s-kv">
        ${s.body.reach.map((r) => `<div><dt>${r.label}</dt><dd>${r.px} px<small>${r.px === r.base ? 'same as TEMP' : `TEMP ${r.base} px`}</small></dd></div>`).join('\n        ')}
      </dl>
    </div>
    <div>
      <h2 class="s-h2">MECHANICS</h2>
      ${s.mechanics.length ? `<ul class="s-mech">${s.mechanics.map((m) => `<li><b>${esc(m.label)}</b><span>${esc(m.text)}</span></li>`).join('')}</ul>` : '<p class="s-note">Nothing special: the shared rules, played straight.</p>'}
      ${s.strings.dropped.length ? `<p class="s-note">Drops the shared ${s.strings.dropped.map(esc).join(' and ')} string${s.strings.dropped.length > 1 ? 's' : ''}.</p>` : ''}
    </div>
  </section>

  <section class="s-section" id="moves">
    <h2 class="s-h2">UNIQUE MOVES</h2>
    ${s.moves.length ? `<p class="s-note">Frames are at 60 fps, from the animation's own timing. Damage is before ${s.name}'s ${s.damageMul.toFixed(2)}x damage stat. On block is about right, before any string follow-up. Tap or hover a move to replay it.</p>
    <div class="s-moves">
    ${s.moves.map((m) => moveCard(s, m)).join('\n    ')}
    </div>` : `<p class="s-lede">${esc(s.name)} has no unique moves. Every shared move and every shared string, exactly as the game started: the baseline every other fighter is measured against.</p>`}
  </section>

  <section class="s-section" id="strings">
    <h2 class="s-h2">STRINGS AND ENDERS</h2>
    <p class="s-note">Press in rhythm: each press goes in during the last hit's recovery. Damage is for the whole string landing on TEMP, with combo decay. Stamina is the bar it spends, out of 100.</p>
    ${stringsTable(s)}
  </section>

  <section class="s-section" id="basics">
    <details class="s-details">
      <summary><h2 class="s-h2">SHARED BASICS</h2><span>Every fighter has these. ${s.basics.filter((b) => b.replacedBy).length ? 'Struck through: replaced by a unique move.' : ''}</span></summary>
      <p class="s-note">→ is toward the other fighter. Reach is on ${esc(s.name)}'s body.</p>
      ${basicsTable(s)}
    </details>
  </section>

  <nav class="s-prevnext" aria-label="More fighters">
    <a href="../${prev.id}/" rel="prev" style="--c:${prev.color}"><small>PREVIOUS</small>${esc(prev.name)}</a>
    <a href="../" class="s-all"><small>BACK TO</small>ALL FIGHTERS</a>
    <a href="../${next.id}/" rel="next" style="--c:${next.color}"><small>NEXT</small>${esc(next.name)}</a>
  </nav>
</main>
${footer(root)}
${script(root)}
</body>
</html>
`;
}
