// Shim that exposes the native fetch API (available in Obsidian/Electron)
// instead of the Node-only node-fetch implementation.
module.exports = globalThis.fetch;
module.exports.default = globalThis.fetch.bind(globalThis);
module.exports.Headers = globalThis.Headers;
module.exports.Request = globalThis.Request;
module.exports.Response = globalThis.Response;
