import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API_ROUTES = new Set(['chat', 'hadith', 'feedback', 'geo', 'title']);

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

/**
 * Runs the functions in api/ inside `npm run dev` with the keys from .env.local, so the whole app
 * (answers, hadith checks, feedback) works on localhost without deploying. Adds the small part of
 * Vercel's request/response helpers the handlers use. LOCAL_COUNTRY=PK (or IR, AF…) pretends to be
 * a visitor from that country, to try the first-visit language.
 */
const localApi = (): Plugin => ({
  name: 'salaf-local-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname.match(/^\/api\/([a-z]+)\/?$/)?.[1];
      if (!route || !API_ROUTES.has(route)) return next();

      try {
        const raw = req.method === 'POST' ? await readBody(req) : '';
        const request = Object.assign(req, {
          query: Object.fromEntries(url.searchParams),
          body: raw ? JSON.parse(raw) : undefined,
          cookies: {},
        });
        if (process.env.LOCAL_COUNTRY) request.headers['x-vercel-ip-country'] = process.env.LOCAL_COUNTRY;

        const response = Object.assign(res, {
          status(code: number) {
            res.statusCode = code;
            return response;
          },
          json(value: unknown) {
            if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(value));
            return response;
          },
          send(value: unknown) {
            res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
            return response;
          },
        });

        const module = await server.ssrLoadModule(`/api/${route}.ts`);
        await module.default(request, response);
      } catch (error) {
        console.error(`[local api] /api/${route} failed:`, error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.end(JSON.stringify({ error: { code: 'LOCAL_API_ERROR', message: String(error) } }));
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  // Server-side keys (no VITE_ prefix) stay out of the browser bundle; only the local API reads them.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value;
  }

  return {
    server: {
      // `vercel dev` runs Vite behind its own server on $PORT and answers /api/* before it gets here.
      port: Number(process.env.PORT) || 3000,
      // Local only: in dev the API runs with the real keys from .env.local, so other devices on the
      // network must not reach it. `HOST=0.0.0.0 npm run dev` opens it up deliberately (phone testing).
      host: process.env.HOST || 'localhost',
    },
    plugins: [
      localApi(),
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifestFilename: 'manifest.json',
        includeAssets: ['logo.png', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png'],
        manifest: {
          name: 'Salaf AI | باحث السلف',
          short_name: 'Salaf AI',
          description: 'باحث شرعي يعمل بالذكاء الاصطناعي وفق منهج السلف الصالح',
          start_url: '/',
          id: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#0b0b0c',
          theme_color: '#0b0b0c',
          // Desktop and tablet installs (Windows, macOS, Linux, iPad) rotate and resize freely.
          orientation: 'any',
          display_override: ['standalone', 'minimal-ui'],
          prefer_related_applications: false,
          shortcuts: [
            { name: 'سؤال جديد', short_name: 'سؤال جديد', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
            { name: 'عن باحث السلف', short_name: 'عن التطبيق', url: '/about', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          ],
          lang: 'ar',
          dir: 'rtl',
          categories: ['education', 'books'],
          icons: [
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.origin === 'https://fonts.googleapis.com' ||
                url.origin === 'https://fonts.gstatic.com',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'salaf-ai-fonts',
              },
            },
          ],
        },
      }),
    ],
    test: {
      globals: true,
      environment: 'jsdom',
      exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    },
  };
});
