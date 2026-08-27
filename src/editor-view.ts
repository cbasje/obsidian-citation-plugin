import { TextFileView, TFile, WorkspaceLeaf, type IconName } from 'obsidian';
import CitationPlugin from './main';
import {
  type DatabaseType,
  type EntryData,
  Library,
  CIT_VIEW_TYPE,
  type FileType,
} from './types';
import { deserializeEntries, serializeEntries } from './serializer';
import Table from './components/Table.svelte';
import { mount, unmount } from 'svelte';

export class EditorView extends TextFileView {
  /** Raw text last loaded from disk (fallback when nothing has changed). */
  private value = '';
  /** Parsed entries, kept as the source of truth for round-tripping. */
  private entries: EntryData[] = [];
  /** Database type inferred from the file extension. */
  private dbType: DatabaseType | undefined;
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
    // this.contentEl.empty();
    this.entries = [];
    this.dbType = undefined;
    this.value = '';
    this.table.set([]);
  }

  /*
    execute order: onOpen -> onLoadFile -> setViewData -> onUnloadFile -> onClose
  */

  async onOpen() {
    await super.onOpen();
  }

  async onLoadFile(file: TFile) {
    this.table = mount(Table, {
      target: this.contentEl,
      props: {},
    });
    this.table.onChange(() => {
      this.requestSave();
    });

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
    const extension = (this.file?.extension || '').toLowerCase() as FileType;
    const dbType = this.detectDatabaseType(extension);
    if (!dbType) {
      this.renderError(`Unsupported file extension: ".${extension}".`);
      return;
    }

    let entries;
    try {
      entries = deserializeEntries(data, dbType);
    } catch (e) {
      console.error('Citation plugin: failed to parse file', e);
      this.renderError(
        e instanceof Error ? e.message : 'Failed to parse file.',
      );
      return;
    }

    const basePath = this.file?.parent?.path;
    const library = new Library(entries, dbType, basePath);

    this.dbType = dbType;
    this.entries = entries;
    this.table.set(Object.values(library.entries));
    this.value = data;
  }

  private getValue() {
    if (!this.dbType || this.entries.length === 0) {
      return this.value;
    }
    try {
      return serializeEntries(this.entries, this.dbType);
    } catch (e) {
      console.error('Citation plugin: failed to serialize entries', e);
      return this.value;
    }
  }

  private renderError(message: string) {
    console.error(message);
    //   this.containerEl.empty();
    //   this.containerEl.createEl('p', {
    //     text: message,
    //     cls: 'csl-placeholder',
    //   });
  }
}
