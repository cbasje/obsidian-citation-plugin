// Stub for svelte/reactivity — SvelteMap is just a plain Map in tests
// (no reactive tracking needed outside a Svelte component context).
class SvelteMap extends Map {}

module.exports = { SvelteMap };
