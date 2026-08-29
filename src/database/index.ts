import type { TFile } from 'obsidian';
import {
  getEntryMetadata,
  type EntryData,
  type EntryDataCSL,
  type EntryMetadata,
  type FileType,
  fileTypes,
} from '../types';
import { deserializeEntries, serializeEntries } from './serializer';
import type CitationPlugin from '../main';
import { CiteprocEngine } from '../csl/engine';
import { BUNDLED_LOCALE_EN_US } from '../csl/assets';

export class CitationDatabase {
  readonly entries = new Map<string, EntryDataCSL>();
  readonly entriesRich = new Map<string, EntryData | EntryMetadata>();

  public file: TFile;
  readonly citeEngine = new CiteprocEngine(this);
  private vaultPath: string | undefined;

  public isLoading = false;

  constructor(
    private plugin?: CitationPlugin,
    file?: TFile,
  ) {
    this.file = file ?? plugin?.getDefaultDatabase();
    console.debug(
      `Citation manager: Creating database for '${this.file?.path}'`,
    );

    // @ts-expect-error
    this.vaultPath = plugin?.app.vault.adapter.getBasePath?.();
  }

  async load(_raw?: string) {
    if (!this.file || this.isLoading) return;

    console.debug('Citation manager: (Re)loading database');
    this.plugin?.events.trigger('library-load-start');
    this.isLoading = true;

    try {
      let raw: string;
      if (_raw) {
        raw = _raw;
      } else {
        raw = await this.plugin?.app.vault.read(this.file);
      }
      console.debug('RAW', raw);
      const entries = deserializeEntries(raw, this.type);

      this.clear();
      for (const entry of entries) {
        const id = (entry as EntryDataCSL).id;
        this.entries.set(id, entry);
        this.entriesRich.set(
          id,
          getEntryMetadata(id, entry, this.type, this.dir, this.vaultPath),
        );
      }

      // (Re)build the cite engine so bibliography rendering reflects the new data.
      await this.loadCiteEngine();

      this.plugin?.events.trigger('library-load-complete');
      console.debug(
        `Citation manager: successfully loaded database with ${this.size} entries.`,
      );
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      this.isLoading = false;
    }
  }

  get dir(): string {
    return this.file?.parent?.path;
  }

  get size(): number {
    return this.entries.size;
  }

  get ids(): Set<string> {
    return new Set(this.entries.keys());
  }

  get paths(): Set<string> {
    return new Set(
      Array.from(this.entries.keys()).map((id) =>
        this.plugin.getPathForCitekey(this.dir, id),
      ),
    );
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  retrieve(id: string): EntryDataCSL | undefined {
    return this.entries?.get(id);
  }
  retrieveRich(id: string): EntryData | EntryMetadata | undefined {
    return this.entriesRich?.get(id);
  }

  add(entry: EntryData | EntryMetadata) {
    this.entries.set(entry.id, entry);
    this.entriesRich.set(entry.id, entry);
  }
  delete(id: string) {
    this.entries.delete(id);
    this.entriesRich.delete(id);
  }

  clear() {
    this.entries.clear();
    this.entriesRich.clear();
  }

  get type(): FileType | undefined {
    const extension = (this.file?.extension || '').toLowerCase();
    // @ts-expect-error This makes sense
    if (fileTypes.includes(extension)) return extension as FileType;
    return undefined;
  }

  reloadDefault() {
    this.file = this.plugin?.getDefaultDatabase();
  }

  serialize() {
    const entries = Array.from(this.entries.values());
    return serializeEntries(entries, this.type);
  }

  async deserialize(data: string) {
    await this.load(data);
  }

  /**
   * For the given citekey, return a flat object of template variables.
   * All metadata fields are available both at the top level (`{{title}}`)
   * and via `{{entry.title}}`.
   */
  getTemplateVariablesForCitekey(citekey: string): Record<string, any> {
    const entry = this.entries[citekey];
    return entry ? { entry, ...entry } : {};
  }

  /**
   * (Re)build the citeproc engine with the currently selected CSL style and
   * locale. Called on library load and whenever the style setting changes.
   */
  async loadCiteEngine(): Promise<void> {
    if (!this.citeEngine || !this.plugin) return;

    const styleId = this.plugin.settings.cslStyle;
    let customXml: string | undefined;

    if (this.plugin.settings.customCslStylePath) {
      try {
        customXml = await this.plugin.app.vault.adapter.read(
          this.plugin.settings.customCslStylePath,
        );
      } catch (err) {
        console.warn(
          'Citation manager: could not load custom CSL style, falling back to bundled style.',
          err,
        );
      }
    }

    this.citeEngine.setLocale(BUNDLED_LOCALE_EN_US);
    this.citeEngine.configure(styleId, customXml);
  }
}
