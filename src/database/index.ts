import { normalizePath, Notice, type TFile } from 'obsidian';
import { DISALLOWED_FILENAME_CHARACTERS_RE } from '../util';
import {
  getEntryMetadata,
  type EntryDataCSL,
  type EntryMetadata,
  type FileType,
  fileTypes,
} from '../types';
import { deserializeEntries, serializeEntries } from './serializer';
import type CitationPlugin from '../main';
import { plugins } from '@citation-js/core';
import CSL from 'citeproc';
import type { Citation, CitationItem, CiteprocSys } from 'citeproc';
import type { CiteOptions } from '../csl/assets';
import { SvelteMap } from 'svelte/reactivity';
export { DatabaseRegistry } from './registry';
import '@citation-js/plugin-csl';

export class CitationDatabase {
  readonly entries = new SvelteMap<string, EntryDataCSL>();
  readonly entriesRich = new SvelteMap<string, EntryMetadata>();

  /**
   * Literature note paths per citekey, rendered from the title template.
   * Knap rendering is asynchronous, so paths are cached here after every
   * load/add/delete and exposed as a SvelteMap so UI consumers (e.g.
   * editor hover links) update reactively once rendering completes.
   */
  readonly notePaths = new SvelteMap<string, string>();

  /** Serialized in-flight note path refresh chain. */
  private notePathsRefresh: Promise<void> = Promise.resolve();

  public _file: TFile | undefined;
  public path: string | undefined;
  public vaultPath: string | undefined;

  public isLoading = false;

  constructor(file: string, plugin?: CitationPlugin);
  constructor(file: TFile, plugin?: CitationPlugin);
  constructor(
    file: TFile | string,
    private plugin?: CitationPlugin,
  ) {
    if (typeof file === 'string') {
      this.path = file;
    } else {
      this._file = file;
      this.path = file?.path;
    }
    console.debug(`Citation manager: Creating database for '${this.path}'`);

    // @ts-expect-error There is a optional parameter
    this.vaultPath = plugin?.app.vault.adapter.getBasePath?.();
  }

  async save() {
    if (this.isLoading || !this.file) return;

    console.debug('Citation manager: Saving database');
    this.plugin?.events.trigger('library-save-start');

    try {
      const data = serializeEntries(
        Array.from(this.entries.values()),
        this.type,
      );
      await this.plugin.app.vault.modify(this.file, data);

      this.plugin?.events.trigger('library-save-complete');
      console.debug(
        `Citation manager: successfully saved database with ${this.entries.size} entries.`,
      );
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async load(_raw?: string) {
    if (this.isLoading || !this.file) return;

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
      // No plugin/vault available (e.g. unit tests): nothing to load.
      if (raw === undefined) return;
      const entries = deserializeEntries(raw, this.type);

      this.clear();
      for (const entry of entries) {
        const id = (entry as EntryDataCSL).id;
        this.entries.set(id, { citekey: id, ...entry });
        this.entriesRich.set(
          id,
          getEntryMetadata(id, entry, this.type, this.dir, this.vaultPath),
        );
      }

      this.plugin?.events.trigger('library-load-complete');
      console.debug(
        `Citation manager: successfully loaded database with ${this.entries.size} entries.`,
      );

      // Warm the note path cache (async; failures are logged inside).
      this.refreshNotePaths();
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      this.isLoading = false;
    }
  }

  set file(f: TFile) {
    this._file = f;
  }

  get file(): TFile {
    if (this._file) return this._file;
    if (this.path) return this.plugin.app.vault.getFileByPath(this.path);
  }

  get dir(): string {
    return this.file?.parent?.path;
  }

  get ids() {
    return Array.from(this.entries.keys());
  }

  /**
   * Queue a re-render of cached literature note paths. Only citekeys
   * without a cached path are rendered; pass `force` to re-render all
   * of them (e.g. after a title template settings change). Runs are
   * serialized so bursts of add/delete calls don't race; render
   * failures are logged and leave the citekey uncached for retry.
   */
  refreshNotePaths(force = false): Promise<void> {
    this.notePathsRefresh = this.notePathsRefresh.then(() =>
      this.renderNotePaths(force),
    );
    return this.notePathsRefresh;
  }

  private async renderNotePaths(force: boolean): Promise<void> {
    if (!this.plugin) return;
    if (force) this.notePaths.clear();

    try {
      for (const id of this.ids) {
        if (this.notePaths.has(id)) continue;
        this.notePaths.set(id, await this.getPathForCitekey(id));
      }
    } catch (e) {
      console.error('Citation manager: failed to render note paths', e);
    }

    for (const id of Array.from(this.notePaths.keys())) {
      if (!this.entries.has(id)) this.notePaths.delete(id);
    }
  }

  /**
   * Reverse lookup: the citekey whose literature note lives at `path`,
   * or undefined when no cached note path matches. Depends on the
   * asynchronously populated `notePaths` cache.
   */
  getCitekeyForNotePath(path: string): string | undefined {
    for (const [citekey, notePath] of this.notePaths) {
      if (notePath === path) return citekey;
    }
    return undefined;
  }

  retrieve(id: string): EntryDataCSL | undefined {
    return this.entries?.get(id);
  }
  retrieveRich(id: string): EntryMetadata | undefined {
    return this.entriesRich?.get(id);
  }

  add(entry: EntryMetadata) {
    this.entries.set(entry.id, entry);
    this.entriesRich.set(entry.id, entry);
    this.refreshNotePaths();
  }

  delete(id: string) {
    this.entries.delete(id);
    this.entriesRich.delete(id);
    this.notePaths.delete(id);
  }

  clear() {
    this.entries.clear();
    this.entriesRich.clear();
    this.notePaths.clear();
  }

  get type(): FileType | undefined {
    const extension = (this.file?.extension || '').toLowerCase();
    // @ts-expect-error This makes sense
    if (fileTypes.includes(extension)) return extension as FileType;
    return undefined;
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
   */
  getTemplateVariablesForCitekey(citekey: string): Record<string, any> {
    return this.entriesRich.get(citekey);
  }

  async getTitleForCitekey(citekey: string): Promise<string> {
    const unsafeTitle = await this.plugin.renderLiteratureNoteTitle(
      this.getTemplateVariablesForCitekey(citekey),
    );
    return unsafeTitle.replace(DISALLOWED_FILENAME_CHARACTERS_RE, '_');
  }

  async getPathForCitekey(citekey: string): Promise<string> {
    const title = await this.getTitleForCitekey(citekey);
    const notesFolder =
      this.plugin.settings.literatureNoteFolder || 'Reading notes';
    const notesSep = notesFolder && !notesFolder.endsWith('/') ? '/' : '';

    const parentFolder = this.dir;
    const parentSep = parentFolder && !parentFolder.endsWith('/') ? '/' : '';

    return normalizePath(
      `${parentFolder}${parentSep}${notesFolder}${notesSep}${title}.md`,
    );
  }

  async getInitialContentForCitekey(citekey: string): Promise<string> {
    return this.plugin.renderLiteratureNoteContent(
      this.getTemplateVariablesForCitekey(citekey),
    );
  }

  /**
   * Run a case-insensitive search for the literature note file corresponding to
   * the given citekey. If no corresponding file is found, create one.
   */
  async getOrCreateLiteratureNoteFile(citekey: string): Promise<TFile> {
    const notePath = await this.getPathForCitekey(citekey);

    let file = this.plugin.app.vault.getAbstractFileByPath(notePath);
    if (file == null) {
      // First try a case-insensitive lookup.
      const matches = this.plugin.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.toLowerCase() == notePath.toLowerCase());
      if (matches.length > 0) {
        file = matches[0];
      } else {
        try {
          file = await this.plugin.app.vault.create(
            notePath,
            await this.getInitialContentForCitekey(citekey),
          );
        } catch (exc) {
          new Notice(
            'Unable to access literature note. Please check that the literature note folder exists, or update the Citations plugin settings.',
          );
          throw exc;
        }
      }
    }

    return file as TFile;
  }

  async openLiteratureNote(citekey: string, newPane: boolean): Promise<void> {
    this.getOrCreateLiteratureNoteFile(citekey)
      .then((file: TFile) => {
        this.plugin.app.workspace.getLeaf(newPane).openFile(file);
      })
      .catch(console.error);
  }

  addCustomCitationStyle(input: string) {
    const config = plugins.config.get('@csl');
    config.templates.add('custom', input);
  }

  /**
   * Render a bibliography (reference list) for the given citekeys.
   * Returns an array of HTML strings, one per entry.
   */
  renderBibliography(citekeys: string[], opts?: CiteOptions): string[] {
    try {
      const validIds = citekeys.filter((id) => this.entries.has(id));
      if (validIds.length === 0) return [];

      const engine = this.buildCiteEngine(opts);
      engine.updateItems(validIds);
      const [, bibBody] = engine.makeBibliography();
      return bibBody;
    } catch (err) {
      console.error('Citation manager: bibliography render error:', err);
    }
    return [];
  }

  /**
   * Render an in-text citation cluster for the given citekeys.
   */
  renderCitationCluster(citekeys: string[], opts?: CiteOptions): string {
    try {
      const validIds = citekeys.filter((id) => this.entries.has(id));
      if (validIds.length === 0) return '';

      const engine = this.buildCiteEngine(opts);
      engine.updateItems(validIds);
      return engine.makeCitationCluster(validIds.map((id) => ({ id })));
    } catch (err) {
      console.error('Citation manager: citation cluster render error:', err);
    }
    return '';
  }

  /**
   * Build a fresh citeproc-js `Engine` seeded with every entry currently
   * in the database. The engine is cheap to construct when the style XML
   * is already cached by citation-js, and — unlike `Cite.format('citation')`
   * — it exposes `rebuildProcessorState`, which is the only way to render
   * a *batch* of in-text citations with correct sequential numbering for
   * numeric styles (e.g. IEEE) in a single pass.
   */
  private buildCiteEngine(opts?: CiteOptions): InstanceType<typeof CSL.Engine> {
    const cslConfig = plugins.config.get('@csl');
    if (!cslConfig) throw new Error('CSL plugin not configured');

    const style = opts?.style ?? this.plugin?.settings.cslStyle;
    const stylePath = this.plugin?.settings.customCslStylePath;
    const styleXml =
      style === 'custom' && stylePath
        ? stylePath
        : (cslConfig.templates.get(style) ?? cslConfig.templates.get('apa'));

    if (!styleXml) {
      throw new Error(
        `Unknown citation style: ${this.plugin?.settings.cslStyle}`,
      );
    }

    const lang = opts?.language || this.plugin?.settings.cslLanguage || 'en-US';

    const items: Record<string, EntryDataCSL> = {};
    for (const [id, entry] of this.entries) {
      items[id] = entry;
    }

    const sys: CiteprocSys = {
      retrieveLocale: (l: string) =>
        cslConfig.locales.get(l) ?? cslConfig.locales.get('en-US') ?? {},
      retrieveItem: (id: string) => items[id],
    };

    return new CSL.Engine(sys, styleXml, lang, true);
  }

  /**
   * Render a batch of in-text citations in document order. Uses
   * citeproc-js `rebuildProcessorState`, which resets and renders the
   * whole batch in a single pass (assigning correct sequential numbers
   * for numeric styles like IEEE within the batch) without re-parsing
   * the CSL style XML.
   *
   * Returns an array of HTML strings, one per input citation (in the
   * same order). Empty strings for citations with no valid citekeys.
   */
  renderInlineCitationsBatch(
    citations: CitationItem[][],
    opts?: CiteOptions,
  ): string[] {
    const results: string[] = citations.map(() => '');

    // Build citeproc Citation objects in document order, skipping
    // citations whose items are all unknown.
    const citationObjs: { originalIndex: number; citation: Citation }[] = [];
    const allIds = new Set<string>();

    for (let i = 0; i < citations.length; i++) {
      const validItems = citations[i]!.filter((item) =>
        this.entries.has(item.id),
      );
      if (validItems.length === 0) continue;
      for (const item of validItems) allIds.add(item.id);
      citationObjs.push({
        originalIndex: i,
        citation: {
          citationID: `cit-${i}`,
          citationItems: validItems,
          properties: { noteIndex: i + 1, index: i },
        },
      });
    }

    if (citationObjs.length === 0) return results;

    try {
      const engine = this.buildCiteEngine(opts);
      engine.updateItems(Array.from(allIds));

      const triples = engine.rebuildProcessorState(
        citationObjs.map((o) => o.citation),
        'html',
        [],
      );

      for (let j = 0; j < triples.length; j++) {
        const originalIndex = citationObjs[j]!.originalIndex;
        results[originalIndex] = triples[j]![2];
      }
    } catch (err) {
      console.error('Citation manager: inline citation render error:', err);
    }

    return results;
  }
}
