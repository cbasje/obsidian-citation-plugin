// Jest transformer that loads .csl / .xml files as raw string modules,
// mirroring the esbuild `text` loader used for the production build.
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
