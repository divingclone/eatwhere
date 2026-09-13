import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (env.AMAP_WEB_SERVICE_KEY) process.env.AMAP_WEB_SERVICE_KEY = env.AMAP_WEB_SERVICE_KEY;
  return {
    plugins: [
      svelte(),
      {
        name: 'local-routing-apis',
        configureServer(server) {
          server.middlewares.use('/api/geocode', async (req, res) => {
            const { default: handler } = await import('./api/geocode');
            await handler(req, res);
          });
          server.middlewares.use('/api/driving', async (req, res) => {
            const { default: handler } = await import('./api/driving');
            await handler(req, res);
          });
        },
      },
    ],
    build: {
      rollupOptions: { output: { manualChunks: { map: ['leaflet'] } } },
    },
  };
});
