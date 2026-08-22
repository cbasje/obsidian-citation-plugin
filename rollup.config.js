import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import webWorkerLoader from 'rollup-plugin-web-worker-loader';
import { readFileSync } from 'fs';

export default {
  input: 'src/main.ts',
  output: {
    dir: '.',
    sourcemap: 'inline',
    format: 'cjs',
    exports: 'default',
  },
  external: ['obsidian', 'path', 'fs', 'util', 'events', 'stream', 'os'],
  plugins: [
    /**
     * Chokidar hacks to get working with platform-general Electron build.
     *
     * HACK: Manually replace fsevents import. This is only available on OS X,
     * and we need to make a platform-general build here.
     */
    replace({
      delimiters: ['', ''],
      include: "node_modules/chokidar/**/*.js",

      "require('fsevents')": "null",
      "require('fs')": "require('original-fs')",
    }),

    typescript(),
    nodeResolve({ browser: true }),
    commonjs({ ignore: ['original-fs'] }),
    json(),
    {
      // Inline raw string imports for bundled CSL style (.csl) and locale
      // (.xml) files.
      name: 'raw-asset',
      load(id) {
        if (id.endsWith('.csl') || id.endsWith('.xml')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`;
        }
        return null;
      },
    },
    webWorkerLoader({
      targetPlatform: 'browser',
      extensions: ['.ts'],
      preserveSource: true,
      sourcemap: true,
    }),
  ],
};
