// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static build → ./dist. Cloudflare Pages serves dist/ and runs functions/ on every request.
// Shiki code highlighting is built into Astro's Markdown pipeline (configured per-artifact later).
export default defineConfig({
  output: 'static',
  site: 'https://artifacts.hoangtrung.dev',
  integrations: [sitemap()],
});
