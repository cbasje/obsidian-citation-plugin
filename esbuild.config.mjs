import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url'; import esbuildSvelte from 'esbuild-svelte';
import LightningCSS from 'unplugin-lightningcss/esbuild';
import browserslist from 'browserslist';
import { browserslistToTargets, Features } from 'lightningcss';
import { sveltePreprocess } from 'svelte-preprocess';

const prod = process.argv[2] === 'production';
const stubPath = fileURLToPath(new URL('./stub-fetch.js', import.meta.url));

const nodePrefixed = builtinModules.map((m) => `node:${m}`);

const targets = browserslistToTargets(browserslist('>= 0.25%'));

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
    'node-fetch': fileURLToPath(
      new URL('./stub-node-fetch.js', import.meta.url),
    ),
    'fetch-ponyfill': fileURLToPath(
      new URL('./stub-fetch-ponyfill.js', import.meta.url),
    ),
  },
  format: 'cjs',
  target: 'esnext',
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
  plugins: [
    LightningCSS({
      options: {
        targets,
        include: Features.Nesting
      }
    }),
    esbuildSvelte({
      compilerOptions: { css: 'injected' },
      preprocess: sveltePreprocess(),
    }),
  ]
});

try {
  if (prod) {
    await context.rebuild();
    process.exit(0);
  } else {
    await context.watch();
  }
} catch {
  process.exit(1);
}
