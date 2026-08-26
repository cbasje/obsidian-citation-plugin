import type { EntryData, EntryDataCSL } from '../types';

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
   *
   * Entries are always CSL-JSON — for BibLaTeX databases, Citation.js
   * handles the conversion during `loadEntries`.
   */
  load(entries: EntryData[]): void {
    this.items.clear();
    for (const entry of entries) {
      const csl = entry as EntryDataCSL;
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
