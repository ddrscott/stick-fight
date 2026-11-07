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
  },
});
