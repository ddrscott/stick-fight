/// <reference types="node" />
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore: a plain ESM module (the site generator's plugin)
import { sitePlugin } from './site/vite-plugin.mjs';

// A build id, so a running game can tell a newer deploy is out (src/update.js polls version.json):
// the short git commit plus the build time.
let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
const BUILD_ID = `${commit}-${Date.now().toString(36)}`;

// The app is served at https://neonstickfight.com/ and uses only relative URLs (base './'), so the
// same build runs at any path (the Worker still serves it at askscottpierce.com/stick-fight/ while
// that address is on "serve", README Hosting). The output is the Worker's assets directory, dist/.
// It's several pages (README, "Site"): the homepage (index.html), the game (play/index.html) and the
// fighter pages that site/vite-plugin.mjs generates into fighters/ and lists as build inputs.
export default defineConfig({
  base: './',
  appType: 'mpa',   // dev serves each page's own index.html; an unknown path is a 404, not the homepage
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [{
    name: 'version-json',
    apply: 'build',
    writeBundle(opts) { writeFileSync(join(opts.dir || 'dist', 'version.json'), JSON.stringify({ build: BUILD_ID, at: new Date().toISOString() }) + '\n'); },
  }, {
    // crew/<slug> and room/<CODE> are the game page under the room's own address (README, Site, Old links).
    // In production the Worker answers them (worker/og.ts); here the dev server does the same: it serves
    // play/index.html with a <base href="/play/"> so the page's play/-relative paths resolve.
    name: 'room-links',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = /^\/(crew|room)\/[^/?#]+\/?(\?.*)?$/.exec(req.url || '');
        if (m) req.url = '/play/index.html' + (m[2] || '');
        next();
      });
    },
    transformIndexHtml(html, ctx) {
      return /^\/(crew|room)\//.test(ctx.originalUrl || '') ? html.replace(/<head>/, '<head><base href="/play/">') : html;
    },
  }, sitePlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 8077,
    strictPort: true,
    host: true,
    allowedHosts: ['.dataturd.com'],   // the dev tunnel for phone testing
    // online rooms: the page calls ./api/..., which is /api/* on the Worker, in production and under
    // `npm run dev:worker` (wrangler dev, :8787) alike.
    proxy: {
      '/api': { target: process.env.SF_WORKER || 'http://127.0.0.1:8787', ws: true },   // another worktree's Worker can hold 8787: SF_WORKER=http://127.0.0.1:<port>
    },
  },
});
