import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import { readFileSync } from 'fs';

export default {
  input: 'src/main.ts',
  output: {
    dir: '.',
    sourcemap: 'inline',
    format: 'cjs',
    exports: 'default',
  },
  external: ['obsidian'],
  plugins: [
    typescript(),
    nodeResolve({ browser: true }),
    replace({
      values: {
        "require('fs')": 'undefined',
        "require('path')": 'undefined',
      },
      delimiters: ['', ''],
    }),
    commonjs(),
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
  ],
};
