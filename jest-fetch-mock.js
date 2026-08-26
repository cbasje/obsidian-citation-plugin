// Stub for node-fetch / sync-fetch — Citation.js imports these but this
// plugin only parses local BibLaTeX/CSL text and never fetches URLs.
module.exports = () => ({
  text: () => '',
  json: () => ({}),
  ok: true,
  status: 200,
});
