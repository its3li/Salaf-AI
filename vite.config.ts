import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API_ROUTES = new Set(['chat', 'hadith', 'feedback', 'geo', 'title', 'media']);

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

const ABOUT_TITLE = 'عن باحث السلف — كيف يجيب ويتحقق من الأحاديث';
const ABOUT_DESCRIPTION =
  'كيف يجيب باحث السلف بالدليل من القرآن والسنة بفهم السلف، ويتحقق من الأحاديث في الدرر السنية. جرّب التحقق من حديث بنفسك.';
const ABOUT_URL = 'https://salaf-ai.vercel.app/about';

/**
 * Writes about.html: the built index.html with the about page's own title, description and URLs,
 * so link previews (which run no script) and search engines see the right page. vercel.json serves
 * it at /about; the app inside is the same.
 */
const aboutPageHtml = (): Plugin => ({
  name: 'salaf-about-html',
  apply: 'build',
  enforce: 'post',
  generateBundle(_, bundle) {
    const index = bundle['index.html'];
    if (!index || index.type !== 'asset') return;
    const setContent = (html: string, selector: RegExp, value: string) => html.replace(selector, `$1${value}`);
    let html = String(index.source).replace(/<title>[^<]*<\/title>/, `<title>${ABOUT_TITLE}</title>`);
    html = setContent(html, /(<link rel="canonical" href=")[^"]*/, ABOUT_URL);
    html = setContent(html, /(<meta property="og:url" content=")[^"]*/, ABOUT_URL);
    for (const name of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
      html = setContent(html, new RegExp(`(<meta ${name} content=")[^"]*`), ABOUT_DESCRIPTION);
    }
    for (const name of ['property="og:title"', 'name="twitter:title"']) {
      html = setContent(html, new RegExp(`(<meta ${name} content=")[^"]*`), ABOUT_TITLE);
    }
    this.emitFile({ type: 'asset', fileName: 'about.html', source: html });
  },
});

export default defineConfig(({ command, mode }) => {
  // Only the dev server's local API gets the keys from .env.local: never tests (which must not reach
  // real services) and never the build. Server-side keys (no VITE_ prefix) never reach the browser.
  if (command === 'serve' && mode !== 'test') {
    for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
      process.env[key] ??= value;
    }
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
      aboutPageHtml(),
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // Registered by services/appUpdates.ts, which also decides when to switch to a new version.
        injectRegister: false,
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
      // .claude/ holds other sessions' worktrees, each with its own copy of the tests.
      exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**', '.claude/**'],
    },
  };
});
