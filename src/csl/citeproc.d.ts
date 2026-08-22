// Type declarations for the `citeproc` (citeproc-js) CommonJS module.

declare module 'citeproc' {
  export interface CiteprocSys {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    retrieveLocale: (lang: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    retrieveItem: (id: string) => any;
  }

  export interface CitationItem {
    id: string;
    locator?: string;
    label?: string;
    prefix?: string;
    suffix?: string;
    'author-only'?: boolean;
    'suppress-author'?: boolean;
  }

  export interface BibliographyMeta {
    bibliography_id: string;
    maxoffset: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry_ids: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  export interface Citation {
    citationItems: CitationItem[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: Record<string, any>;
  }

  export class Engine {
    constructor(
      sys: CiteprocSys,
      style: string,
      lang?: string,
      forceLang?: boolean,
    );
    updateItems(ids: string[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateUncitedItems(ids: string[]): void;
    makeBibliography(): [BibliographyMeta, string[]];
    makeCitationCluster(items: CitationItem[]): string;
    previewCitationCluster(
      citation: Citation,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pre: any[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      post: any[],
      format: string,
    ): string;
  }

  // citeproc-js exports a single object holding `Engine` and helpers.
  const CSL: {
    Engine: typeof Engine;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  export default CSL;
}
