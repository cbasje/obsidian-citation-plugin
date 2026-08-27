// Shim that replaces fetch-ponyfill with Obsidian's requestUrl, which uses
// Electron's native networking and bypasses browser CORS restrictions
// (Obsidian's origin is app://obsidian, which many servers reject).
const { requestUrl } = require('obsidian');

module.exports = function () {
  const fetch = async (url, opts = {}) => {
    const res = await requestUrl({
      url,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body,
      throw: false,
    });
    // Return a minimal Response-like object. Citation.js only calls
    // .text(), .status, and .headers.get().
    return {
      status: res.status,
      headers: {
        get: (name) => res.headers[name.toLowerCase()] ?? null,
      },
      text: () => Promise.resolve(res.text),
    };
  };

  return {
    fetch,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
    DOMException: globalThis.DOMException,
  };
};
