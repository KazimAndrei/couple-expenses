import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// SHOT=1 подменяет слой данных фикстурой (src/lib/supabase.shot.js) — только для съёмки
// скриншотов App Store. Обычная сборка (npm run build) алиас не подключает.
const shotMode = process.env.SHOT === '1';

export default defineConfig({
  root: '.',
  resolve: {
    // Алиас по регулярке: импорт пишется и как '../lib/supabase.js', и как './supabase.js'
    alias: shotMode
      ? [{ find: /^(\.{1,2}\/)+(lib\/)?supabase\.js$/, replacement: fileURLToPath(new URL('./src/lib/supabase.shot.js', import.meta.url)) }]
      : [],
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    port: 3000,
  },
});
