import {
  DatabaseType,
  EntryData,
  EntryDataBibLaTeX,
  EntryDataCSL,
} from '../types';
import { bibLaTeXToCsl } from './biblatex-to-csl';

/**
 * Holds the raw CSL-JSON items that citeproc-js consumes.
 *
 * citeproc's `sys.retrieveItem` must return the item synchronously, so we
 * build an in-memory index keyed by citekey when the library loads.
 */
export class CslItemRegistry {
  private items = new Map<string, EntryDataCSL>();

  /**
   * Load (replace) the full set of items from parsed database entries.
   */
  load(entries: EntryData[], type: DatabaseType): void {
    this.items.clear();
    for (const entry of entries) {
      const csl =
        type === 'csl-json'
          ? (entry as EntryDataCSL)
          : bibLaTeXToCsl(entry as EntryDataBibLaTeX);
      if (csl && csl.id) {
        this.items.set(csl.id, csl);
      }
    }
  }

  /**
   * Sync lookup used by the citeproc `sys.retrieveItem` callback.
   */
  retrieve = (id: string): EntryDataCSL | undefined => {
    return this.items.get(id);
  };

  has = (id: string): boolean => this.items.has(id);

  ids = (): string[] => Array.from(this.items.keys());

  get size(): number {
    return this.items.size;
  }
}
