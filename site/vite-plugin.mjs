// The site's Vite plugin (README, "Site"). The app has several pages: the homepage (index.html), the
// game (play/index.html) and the generated fighter pages (fighters/, from site/generate.mjs). This plugin
//   - runs the generator in a fresh Node process before a build or a dev start (a fresh process so the
//     character registry is always imported anew), and lists every page as a build input;
//   - fills the homepage's markers from .site/home.json: <!--@roster--> (the cast grid), <!--@count--> (how many fighters) and <!--@stages--> (the arcade ladder's
//     length); a marker with no fill fails the build;
//   - in dev, regenerates and reloads when a character file, the frame data, the rig or the site's own
//     templates change;
//   - cuts the `strategy` field (the fighter pages' STRATEGY tips) out of every character file the browser
//     loads. The tips are for the pages only: the generator reads them in Node, straight from the file, and
//     the game's bundle never carries them. A bundle that still holds one fails the build;
//   - writes sitemap.xml (every page, from the same list as the build inputs) and robots.txt pointing at it.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { SITE } from './templates.mjs';

const WATCH = /[\\/](src[\\/]characters[\\/]|src[\\/]combat[\\/](frameData|strings|hitboxes)\.js|src[\\/]fighter[\\/]index\.js|src[\\/]flow[\\/](controls|ladder)\.js|site[\\/](data|templates|generate|guide)\.mjs)/;

const CHAR_FILE = /[\\/]src[\\/]characters[\\/][^\\/]+\.js$/;
// the field as the character files write it: `  strategy: [` on its own line, down to the `  ],` that closes it
const STRATEGY = /\n  strategy: \[\n[\s\S]*?\n  \],?(?=\n)/;

export function sitePlugin() {
  let root = process.cwd();
  const generate = () => execFileSync(process.execPath, [join(root, 'site', 'generate.mjs')], { stdio: 'inherit', cwd: root });
  const pages = () => {
    const input = { main: resolve(root, 'index.html'), play: resolve(root, 'play/index.html'), fighters: resolve(root, 'fighters/index.html'),
      guide: resolve(root, 'how-to-play/index.html'), 'guide-philosophy': resolve(root, 'how-to-play/philosophy/index.html'), 'guide-strategy': resolve(root, 'how-to-play/strategy/index.html'),
      privacy: resolve(root, 'privacy/index.html'), terms: resolve(root, 'terms/index.html') };
    for (const d of readdirSync(join(root, 'fighters'), { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(root, 'fighters', d.name, 'index.html'))) input[`fighter-${d.name}`] = resolve(root, 'fighters', d.name, 'index.html');
    }
    return input;
  };
  return {
    name: 'stick-fight-site',
    config(cfg, env) {
      root = resolve(cfg.root || process.cwd());
      if (env.isPreview) return;
      generate();
      return { build: { rollupOptions: { input: pages() } } };
    },
    transform(code, id) {
      if (!CHAR_FILE.test(id.split('?')[0]) || !code.includes('strategy:')) return null;
      const out = code.replace(STRATEGY, '');
      if (out.includes('strategy:')) this.error(`[site] ${id}: couldn't cut the strategy field out for the browser. Write it as "  strategy: [" on its own line, closed by "  ]," on its own line.`);
      return { code: out, map: null };
    },
    generateBundle(_, bundle) {
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && /\btips:\s*\[/.test(chunk.code)) this.error(`[site] ${name} carries STRATEGY tips: they belong on the fighter pages only`);
      }
      // the pages, as URLs: index.html -> SITE, fighters/temp/index.html -> SITE + 'fighters/temp/'
      const urls = Object.values(pages()).map((f) => SITE + relative(root, f).split(sep).join('/').replace(/index\.html$/, '')).sort();
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n` });
    },
    transformIndexHtml(html) {
      if (!/<!--@\w+-->/.test(html)) return html;
      const home = JSON.parse(readFileSync(join(root, '.site', 'home.json'), 'utf8'));
      return html.replace(/<!--@(\w+)-->/g, (m, key) => {
        if (!(key in home)) throw new Error(`[site] no fill for ${m} in .site/home.json`);
        return home[key];
      });
    },
    configureServer(server) {
      // like the Worker's auto-trailing-slash: /play and /fighters/courier go on to their folder's page
      server.middlewares.use((req, res, next) => {
        const [path, query] = (req.url || '').split(/\?(.*)/s);
        if (path && !path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path) && existsSync(join(root, path, 'index.html'))) {
          res.statusCode = 307; res.setHeader('Location', path + '/' + (query ? '?' + query : '')); return res.end();
        }
        next();
      });
      let timer = null;
      server.watcher.on('change', (file) => {
        if (!WATCH.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          try { generate(); server.ws.send({ type: 'full-reload' }); } catch (e) { server.config.logger.error(`[site] ${e.message}`); }
        }, 150);
      });
    },
  };
}
