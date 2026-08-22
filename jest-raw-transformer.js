// Jest transformer that loads .csl / .xml files as raw string modules,
// mirroring the rollup raw-asset plugin used for the production build.
module.exports = {
  process(sourceText) {
    return `module.exports = ${JSON.stringify(sourceText)};`;
  },
};
