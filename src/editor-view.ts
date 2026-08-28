import {
  FileSystemAdapter,
  TextFileView,
  TFile,
  WorkspaceLeaf,
  type IconName,
} from 'obsidian';
import CitationPlugin from './main';
import {
  type DatabaseType,
  type EntryData,
  type EntryDataBibLaTeX,
  type EntryDataCSL,
  CIT_VIEW_TYPE,
  type FileType,
} from './types';
import { deserializeEntries, serializeEntries } from './serializer';
import { fetchEntryById, generateCiteKey, type IdType } from './fetcher';
import { AddReferenceModal } from './modals';
import Table from './components/Table.svelte';
import { mount, unmount } from 'svelte';

export class EditorView extends TextFileView {
  /** Raw text last loaded from disk (fallback when serialization fails). */
  private value = '';
  /** Database type inferred from the file extension. */
  private dbType: DatabaseType | undefined;
  /** True only after entries have been successfully loaded into the table. */
  private loaded = false;
  table: ReturnType<typeof Table> | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CitationPlugin,
  ) {
    super(leaf);
  }

  getIcon(): IconName {
    return 'quote';
  }

  getViewType(): string {
    return CIT_VIEW_TYPE;
  }

  getContext(file?: TFile) {
    return file?.path ?? this.file?.path;
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.clear();
    }
    this.setValue(data);
  }

  getViewData(): string {
    return this.getValue();
  }

  clear(): void {
    console.log('clear');
    this.dbType = undefined;
    this.loaded = false;
    this.value = '';
    this.table?.set([]);
  }

  /*
    execute order: onOpen -> onLoadFile -> setViewData -> onUnloadFile -> onClose
  */

  async onOpen() {
    await super.onOpen();
  }

  async onLoadFile(file: TFile) {
    console.log('onLoadFile');
    const extension = this.getFileType();
    const dbType = this.detectDatabaseType(extension);
    if (!dbType) {
      this.renderError(`Unsupported file extension: ".${extension}".`);
      return;
    }

    const basePath = this.file?.parent?.path;
    const vaultPath =
      this.app.vault.adapter instanceof FileSystemAdapter
        ? this.app.vault.adapter.getBasePath()
        : undefined;

    this.table = mount(Table, {
      target: this.contentEl,
      props: {
        dbType,
        basePath,
        vaultPath,
      },
    });
    this.table.onChange(() => {
      this.requestSave();
    });
    this.table.onAdd(() => this.openAddReferenceModal());

    await super.onLoadFile(file);
  }

  async onUnloadFile(file: TFile) {
    await super.onUnloadFile(file);
    if (this.table) {
      unmount(this.table);
    }
  }

  async onClose() {
    await super.onClose();
  }

  private getFileType(): FileType {
    return (this.file?.extension || '').toLowerCase() as FileType;
  }

  private detectDatabaseType(extension: FileType): DatabaseType | undefined {
    switch (extension) {
      case 'bib':
        return 'biblatex';
      case 'json':
        return 'csl-json';
      default:
        return undefined;
    }
  }

  private setValue(data: string) {
    console.log('setValue');
    const extension = this.getFileType();
    const dbType = this.detectDatabaseType(extension);
    if (!dbType) {
      this.renderError(`Unsupported file extension: ".${extension}".`);
      return;
    }

    let entries: EntryData[];
    try {
      entries = deserializeEntries(data, dbType);
    } catch (e) {
      console.error('Citation plugin: failed to parse file', e);
      this.renderError(
        e instanceof Error ? e.message : 'Failed to parse file.',
      );
      return;
    }

    this.dbType = dbType;
    this.table?.set(entries);
    this.value = data;
    this.loaded = true;
  }

  private getValue() {
    console.log('getValue');
    if (!this.loaded || !this.dbType || !this.table) {
      return this.value;
    }

    try {
      return serializeEntries(this.table.get(), this.dbType);
    } catch (e) {
      console.error('Citation plugin: failed to serialize entries', e);
      return this.value;
    }
  }

  private openAddReferenceModal() {
    if (!this.dbType) return;
    new AddReferenceModal(this.app, (idType, id) =>
      this.fetchAndAddEntry(idType, id),
    ).open();
  }

  private async fetchAndAddEntry(idType: IdType, id: string) {
    if (!this.dbType || !this.table) return;
    const fetched = await fetchEntryById(idType, id);
    if (fetched.length === 0) return;

    const existing: Set<string> = new Set();
    for (const e of this.table.get()) {
      existing.add((e as EntryDataCSL).id);
    }
    for (const entry of fetched) {
      entry.id = generateCiteKey(entry, existing);
      existing.add(entry.id);
      const adapted = this.adaptEntry(entry);
      this.table.addEntry(adapted);
    }
  }

  /**
   * Adapt a fetched CSL-JSON entry for the current database type. For
   * biblatex, attach an empty `_biblatex` so serialization uses the
   * CSL-derived fallback rather than crashing on missing raw props.
   */
  private adaptEntry(entry: EntryDataCSL): EntryData {
    if (this.dbType === 'biblatex') {
      return { ...entry, _biblatex: undefined } as EntryDataBibLaTeX;
    }
    return entry;
  }

  private renderError(message: string) {
    console.error(message);
  }
}
