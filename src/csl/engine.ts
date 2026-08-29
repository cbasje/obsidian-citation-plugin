import CSL from 'citeproc';
import type { Citation, CitationItem } from 'citeproc';
import type { CitationDatabase } from '../database';
import {
  makeLocaleRetriever,
  resolveStyleXml,
  type CslStyleId,
} from './assets';

/**
 * A thin wrapper around `citeproc-js`'s `CSL.Engine`.
 *
 * The engine is rebuilt whenever the style changes or the library reloads.
 * Bibliography and citation rendering are synchronous once built.
 */
export class CiteprocEngine {
  private engine: InstanceType<typeof CSL.Engine> | null = null;
  private styleXml: string;
  private localeXml: string;

  constructor(public db: CitationDatabase) { }

  /**
   * (Re)build the underlying citeproc engine with the given style. Any
   * previously registered items are lost; re-register via `renderBibliography`
   * or `renderCitationCluster`.
   */
  configure(styleId: CslStyleId, customStyleXml?: string): void {
    this.styleXml = resolveStyleXml(styleId, customStyleXml);
    this.rebuildEngine();
  }

  /**
   * Set the locale XML used for term lookups. The engine is rebuilt on the
   * next render.
   */
  setLocale(localeXml: string): void {
    this.localeXml = localeXml;
    this.rebuildEngine();
  }

  private rebuildEngine(): void {
    if (!this.styleXml) return;

    const sys = {
      retrieveLocale: makeLocaleRetriever(this.localeXml),
      retrieveItem: this.db.retrieve,
    };

    try {
      this.engine = new CSL.Engine(sys, this.styleXml);
    } catch (err) {
      console.error('Citation manager: failed to build citeproc engine:', err);
      this.engine = null;
    }
  }

  get isReady(): boolean {
    return this.engine !== null;
  }

  /**
   * Render a bibliography (reference list) for the given citekeys.
   * Returns an array of HTML strings, one per entry.
   */
  renderBibliography(citekeys: string[]): string[] {
    if (!this.engine) return [];

    const valid = citekeys.filter((id) => this.db.has(id));
    if (valid.length === 0) return [];

    try {
      this.engine.updateItems(valid);
      const result = this.engine.makeBibliography();
      if (result && result[1]) {
        return result[1];
      }
    } catch (err) {
      console.error('Citation manager: bibliography render error:', err);
    }
    return [];
  }

  /**
   * Render an in-text citation cluster for the given citekeys.
   */
  renderCitationCluster(citekeys: string[]): string {
    if (!this.engine) return '';

    const valid = citekeys.filter((id) => this.db.has(id));
    if (valid.length === 0) return '';

    try {
      this.engine.updateItems(valid);
      return this.engine.makeCitationCluster(valid.map((id) => ({ id })));
    } catch (err) {
      console.error('Citation manager: citation cluster render error:', err);
    }
    return '';
  }

  /**
   * Render a batch of in-text citations in document order. Uses
   * `rebuildProcessorState`, which resets and renders the whole batch in
   * a single pass (assigning correct sequential numbers for numeric
   * styles like IEEE within the batch) without re-parsing the CSL style
   * XML.
   *
   * Returns an array of HTML strings, one per input citation (in the
   * same order). Empty strings for citations with no valid citekeys.
   */
  renderInlineCitationsBatch(citations: CitationItem[][]): string[] {
    if (!this.engine) return citations.map(() => '');

    // Cheaply reset the processor to an empty state so stale citation
    // state from a previous render pass (or a previous reading-view
    // chunk) doesn't accumulate. This replaces a full `new CSL.Engine()`
    // rebuild, which re-parses the style XML and was the main cause of
    // slow first-load rendering.
    this.engine.rebuildProcessorState([]);

    // Build citation objects in document order, keeping the original
    // index in the citationID so we can map results back.
    const results: string[] = citations.map(() => '');
    const objs: { originalIndex: number; citation: Citation }[] = [];
    for (let i = 0; i < citations.length; i++) {
      const validItems = citations[i]!.filter((item) => this.db.has(item.id));
      if (validItems.length === 0) continue;
      objs.push({
        originalIndex: i,
        citation: {
          citationID: `cit-${i}`,
          citationItems: validItems,
          properties: { noteIndex: i + 1, index: i },
        },
      });
    }
    if (objs.length === 0) return results;

    try {
      const triples = this.engine.rebuildProcessorState(
        objs.map((o) => o.citation),
        'html',
      );
      for (const [citationID, , str] of triples) {
        const idx = Number(citationID.replace(/^cit-/, ''));
        if (!Number.isNaN(idx)) results[idx] = str;
      }
    } catch (err) {
      console.error('Citation manager: inline citation render error:', err);
    }

    // Reset to empty again so the engine is left clean for any
    // subsequent bibliography render or batch call.
    this.engine.rebuildProcessorState([]);
    return results;
  }
}
