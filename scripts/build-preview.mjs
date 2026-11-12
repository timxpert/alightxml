#!/usr/bin/env node
/**
 * Offline production build used for verification when Vite is not installed.
 * It produces the same app as `vite build`: esbuild bundles the app and the Web Worker,
 * and Tailwind's compiler generates the CSS from the class names used in src/.
 *
 *   node scripts/build-preview.mjs [outDir]
 */
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(root, process.argv[2] ?? 'dist');
const require = createRequire(import.meta.url);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const common = { bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning', absWorkingDir: root };
await build({ ...common, entryPoints: ['src/worker/analyze.worker.ts'], outfile: path.join(out, 'assets', 'analyze.worker.js') });
await build({ ...common, entryPoints: ['src/main.tsx'], outfile: path.join(out, 'assets', 'main.js') });
const mainJs = path.join(out, 'assets', 'main.js');
const js = fs.readFileSync(mainJs, 'utf8');
if (!js.includes('analyze.worker.ts')) throw new Error('Worker URL not found in bundle');
fs.writeFileSync(mainJs, js.replaceAll('analyze.worker.ts', 'analyze.worker.js'));

// Tailwind: scan sources for candidate class names.
const candidates = new Set();
const walk = (d) => {
  for (const name of fs.readdirSync(d)) {
    const full = path.join(d, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (/\.(tsx?|html)$/.test(name)) {
      const src = fs.readFileSync(full, 'utf8');
      // Arbitrary values such as grid-cols-[repeat(auto-fill,minmax(200px,1fr))] contain brackets and commas,
      // so split on whitespace/quotes only, and also add copies trimmed of surrounding JSX punctuation.
      for (const tok of src.split(/[\s"'`]+/)) {
        if (!tok) continue;
        candidates.add(tok);
        const trimmed = tok.replace(/^[{}(),;<>!]+|[{}(),;<>]+$/g, '');
        if (trimmed) candidates.add(trimmed);
      }
    }
  }
};
walk(path.join(root, 'src'));
const twBase = path.dirname(require.resolve('tailwindcss/package.json'));
const compiler = await compile(fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8'), {
  base: path.join(root, 'src'),
  loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? path.join(twBase, 'index.css') : id.startsWith('tailwindcss/') ? path.join(twBase, id.slice(12)) : path.resolve(base, id);
    return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
  },
});
fs.writeFileSync(path.join(out, 'assets', 'index.css'), compiler.build([...candidates]));

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('href="./src/index.css"', 'href="./assets/index.css"')
  .replace('<script type="module" src="./src/main.tsx"></script>', '<script type="module" src="./assets/main.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(1) + ' KB';
console.log(`Built ${out}\n  assets/main.js ${size('assets/main.js')}\n  assets/analyze.worker.js ${size('assets/analyze.worker.js')}\n  assets/index.css ${size('assets/index.css')}`);
