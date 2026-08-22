import CSL from 'citeproc';
import type { CitationItem } from 'citeproc';
import { CslItemRegistry } from './registry';
import { makeLocaleRetriever, resolveStyleXml, CslStyleId } from './assets';

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
   * Render a single in-text citation from structured citation items
   * (supporting locators, suppress-author, etc.). Uses
   * `previewCitationCluster` so this does not advance the engine's citation
   * state — safe to call repeatedly during Obsidian re-renders.
   */
  renderInlineCitation(items: CitationItem[]): string {
    if (!this.engine) return '';

    const valid = items.filter((item) => this.registry.has(item.id));
    if (valid.length === 0) return '';

    try {
      this.engine.updateItems(valid.map((i) => i.id));
      return this.engine.previewCitationCluster(
        { citationItems: valid, properties: {} },
        [],
        [],
        'html',
      );
    } catch (err) {
      console.error('Citation plugin: inline citation render error:', err);
    }
    return '';
  }
}
