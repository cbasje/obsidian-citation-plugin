// Stub for sync-fetch — Citation.js uses this for synchronous URL fetching,
// but native fetch is async-only. Cite.async() uses the async path
// (fetchFileAsync) so the fetch function should never be called at runtime.
// If it is, throw a clear error rather than silently returning empty data.
//
// Headers/Response/etc. are exposed as properties so that `instanceof`
// checks in Citation.js's normaliseHeaders() don't throw.
module.exports = () => {
  throw new Error(
    'Citation manager: synchronous fetch is not supported. Use Cite.async() instead.',
  );
};
module.exports.default = module.exports;
module.exports.Headers = globalThis.Headers;
module.exports.Request = globalThis.Request;
module.exports.Response = globalThis.Response;
