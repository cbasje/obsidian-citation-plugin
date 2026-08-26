// Stub for node-fetch / sync-fetch — Citation.js imports these for URL
// fetching, but this plugin only parses local BibLaTeX/CSL text.
module.exports = () => ({
  text: () => '',
  json: () => ({}),
  ok: true,
  status: 200,
});
module.exports.default = module.exports;
