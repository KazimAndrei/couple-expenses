// Страховка перед релизом: в dist не должно быть фикстуры для скриншотов
// (src/lib/supabase.shot.js). Она подключается алиасом только при SHOT=1, но собрать
// релиз из каталога, где остался shot-бандл, — ошибка на одну переменную окружения.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARKERS = ['Alex & Sam', 'supabase.shot'];
const root = 'dist';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const hits = walk(root)
  .filter((f) => f.endsWith('.js') || f.endsWith('.html'))
  .flatMap((f) => {
    const text = readFileSync(f, 'utf8');
    return MARKERS.filter((m) => text.includes(m)).map((m) => `${f}: ${m}`);
  });

if (hits.length) {
  console.error('В сборке осталась screenshot-фикстура — пересоберите без SHOT=1:');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log('dist чист: фикстуры нет');
