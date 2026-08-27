// Type declarations for @citation-js/core (no bundled types).
// Only the API surface used by this plugin is declared.

declare module '@citation-js/core' {
  export interface CSL {
    [key: string]: unknown;
  }

  export class Cite {
    constructor(input: string, options?: Record<string, unknown>);
    data: CSL[];
    static async(
      input: string,
      options?: Record<string, unknown>,
    ): Promise<Cite>;
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
      add(name: string, config: unknown): void;
      get(name: string): Record<string, unknown> | undefined;
      has(name: string): boolean;
      remove(name: string): void;
      list(): string[];
    };
    list(): string[];
    has(name: string): boolean;
    add(name: string, config: Record<string, unknown>): void;
    remove(name: string): void;
  };

  export const util: {
    setUserAgent(input: string): void;
    fetchFile(url: string, opts?: Record<string, unknown>): string;
    fetchFileAsync(
      url: string,
      opts?: Record<string, unknown>,
    ): Promise<string>;
  };

  const version: string;
}

declare module '@citation-js/plugin-bibtex' {
  // Side-effect import: registers BibTeX/BibLaTeX formats with @citation-js/core.
}

declare module '@citation-js/plugin-doi' {
  // Side-effect import: registers DOI input format with @citation-js/core.
}

declare module '@citation-js/plugin-isbn' {
  // Side-effect import: registers ISBN input format with @citation-js/core.
}

declare module '@citation-js/plugin-pubmed' {
  // Side-effect import: registers PubMed input format with @citation-js/core.
}

declare module '@citation-js/plugin-orcid' {
  // Side-effect import: registers ORCID input format with @citation-js/core.
}

declare module '@citation-js/plugin-url' {
  // Side-effect import: registers URL input format with @citation-js/core.
}
