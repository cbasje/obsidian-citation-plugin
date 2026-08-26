import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const prod = process.argv[2] === 'production';
const stubPath = fileURLToPath(new URL('./stub-fetch.js', import.meta.url));

const nodePrefixed = builtinModules.map((m) => `node:${m}`);

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
    ...nodePrefixed,
  ],
  alias: {
    'sync-fetch': stubPath,
    'node-fetch': stubPath,
  },
  format: 'cjs',
  target: 'es2021',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
  loader: {
    // Inline bundled CSL style and locale files as raw strings.
    '.csl': 'text',
    '.xml': 'text',
  },
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
