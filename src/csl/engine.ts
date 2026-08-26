import CSL from 'citeproc';
import type { CitationItem } from 'citeproc';
import { CslItemRegistry } from './registry';
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
  private registry: CslItemRegistry;
  private styleXml: string;
  private localeXml: string;

  constructor(registry: CslItemRegistry) {
    this.registry = registry;
  }

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
      retrieveItem: this.registry.retrieve,
    };

    try {
      this.engine = new CSL.Engine(sys, this.styleXml);
    } catch (err) {
      console.error('Citation plugin: failed to build citeproc engine:', err);
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

    const valid = citekeys.filter((id) => this.registry.has(id));
    if (valid.length === 0) return [];

    try {
      this.engine.updateItems(valid);
      const result = this.engine.makeBibliography();
      if (result && result[1]) {
        return result[1];
      }
    } catch (err) {
      console.error('Citation plugin: bibliography render error:', err);
    }
    return [];
  }

  /**
   * Render an in-text citation cluster for the given citekeys.
   */
  renderCitationCluster(citekeys: string[]): string {
    if (!this.engine) return '';

    const valid = citekeys.filter((id) => this.registry.has(id));
    if (valid.length === 0) return '';

    try {
      this.engine.updateItems(valid);
      return this.engine.makeCitationCluster(valid.map((id) => ({ id })));
    } catch (err) {
      console.error('Citation plugin: citation cluster render error:', err);
    }
    return '';
  }

  /**
   * Render a batch of in-text citations in document order. This rebuilds
   * the engine's citation state to ensure correct numbering for numeric
   * styles (e.g. IEEE [1], [2], [3]).
   *
   * Returns an array of HTML strings, one per input citation (in the same
   * order). Empty strings for citations with no valid citekeys.
   */
  renderInlineCitationsBatch(citations: CitationItem[][]): string[] {
    if (!this.engine) return citations.map(() => '');

    // Rebuild the engine to reset citation state, so repeated renders
    // (Obsidian re-renders) don't accumulate stale citation numbers.
    this.rebuildEngine();
    if (!this.engine) return citations.map(() => '');

    // Register all referenced items in first-appearance order.
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const items of citations) {
      for (const item of items) {
        if (this.registry.has(item.id) && !seen.has(item.id)) {
          seen.add(item.id);
          orderedIds.push(item.id);
        }
      }
    }
    if (orderedIds.length === 0) return citations.map(() => '');
    this.engine.updateItems(orderedIds);

    // Process each citation in document order. appendCitationCluster
    // registers the citation and returns the rendered string.
    const results: string[] = [];
    for (let i = 0; i < citations.length; i++) {
      const validItems = citations[i]!.filter((item) =>
        this.registry.has(item.id),
      );
      if (validItems.length === 0) {
        results.push('');
        continue;
      }
      try {
        const rendered = this.engine.appendCitationCluster({
          citationID: `cit-${i}`,
          citationItems: validItems,
          properties: { noteIndex: i + 1 },
        });
        // appendCitationCluster returns [[index, string, citationID], ...]
        if (Array.isArray(rendered) && rendered.length > 0) {
          results.push(rendered[0]![1]);
        } else {
          results.push('');
        }
      } catch (err) {
        console.error('Citation plugin: inline citation render error:', err);
        results.push('');
      }
    }

    // Rebuild again to clean up citation state for the next render pass
    // (e.g. bibliography rendering).
    this.rebuildEngine();
    this.engine.updateItems(orderedIds);

    return results;
  }
}
