// The site's Vite plugin (README, "Site"). The app has several pages: the homepage (index.html), the
// game (play/index.html) and the generated fighter pages (fighters/, from site/generate.mjs). This plugin
//   - runs the generator in a fresh Node process before a build or a dev start (a fresh process so the
//     character registry is always imported anew), and lists every page as a build input;
//   - fills the homepage's markers from .site/home.json: <!--@roster--> (the cast grid), <!--@controls-->
//     (the controls tables), <!--@count--> (how many fighters) and <!--@stages--> (the arcade ladder's
//     length); a marker with no fill fails the build;
//   - in dev, regenerates and reloads when a character file, the frame data, the rig or the site's own
//     templates change.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WATCH = /[\\/](src[\\/]characters[\\/]|src[\\/]combat[\\/](frameData|strings|hitboxes)\.js|src[\\/]fighter[\\/]index\.js|src[\\/]flow[\\/](controls|ladder)\.js|site[\\/](data|templates|generate)\.mjs)/;

export function sitePlugin() {
  let root = process.cwd();
  const generate = () => execFileSync(process.execPath, [join(root, 'site', 'generate.mjs')], { stdio: 'inherit', cwd: root });
  const pages = () => {
    const input = { main: resolve(root, 'index.html'), play: resolve(root, 'play/index.html'), fighters: resolve(root, 'fighters/index.html') };
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
