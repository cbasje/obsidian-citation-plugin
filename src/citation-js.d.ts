// Type declarations for @citation-js/core (no bundled types).
// Only the API surface used by this plugin is declared.

declare module '@citation-js/core' {
  export interface CSL {
    [key: string]: unknown;
  }

  export class Cite {
    constructor(input: string, options?: Record<string, unknown>);
    data: CSL[];
  }

  interface RawBibLaTeXEntry {
    type: string;
    label: string;
    properties: Record<string, string>;
  }

  export const plugins: {
    input: {
      chainLink(input: string): RawBibLaTeXEntry[];
      chain(input: string, options?: Record<string, unknown>): CSL[];
      type(input: string): string;
    };
    list(): string[];
    has(name: string): boolean;
  };
}

declare module '@citation-js/plugin-bibtex' {
  // Side-effect import: registers BibTeX/BibLaTeX formats with @citation-js/core.
}
