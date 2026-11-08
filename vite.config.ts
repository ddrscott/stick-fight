import { defineConfig } from 'vite';

// The game is served at https://askscottpierce.com/stick-fight/ but uses only relative URLs
// (base './'), so the same build runs at any path. The output goes to dist/stick-fight/ because
// the Worker's assets directory is dist/, which makes file path equal URL path.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/stick-fight',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 8077,
    strictPort: true,
    host: true,
    allowedHosts: ['.dataturd.com'],   // the dev tunnel for phone testing
    // online rooms: the page calls ./api/..., which in production is /stick-fight/api/* on the
    // Worker. In development that Worker runs under `npm run dev:worker` (wrangler dev, :8787).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        ws: true,
        rewrite: (p) => '/stick-fight' + p,
        // the session cookie is scoped to /stick-fight (the domain is shared); here the page is at /
        cookiePathRewrite: { '/stick-fight': '/' },
      },
    },
  },
});
