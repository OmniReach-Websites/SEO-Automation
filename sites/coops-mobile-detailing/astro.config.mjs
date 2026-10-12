import { defineConfig } from 'astro/config';

export default defineConfig({
  build: { format: 'directory' },
  compressHTML: true,
  output: 'static',
  site: 'https://coopsmobiledetailingaledo.com',
});
