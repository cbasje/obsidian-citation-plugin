import { TextFileView, TFile, WorkspaceLeaf, type IconName } from 'obsidian';
import CitationPlugin from './main';
import {
  type DatabaseType,
  type EntryData,
  CIT_VIEW_TYPE,
  type FileType,
} from './types';
import { deserializeEntries, serializeEntries } from './serializer';
import Table from './components/Table.svelte';
import { mount, unmount } from 'svelte';

export class EditorView extends TextFileView {
  /** Raw text last loaded from disk (fallback when serialization fails). */
  private value = '';
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
    this.dbType = undefined;
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
    const extension = (this.file?.extension || '').toLowerCase() as FileType;
    const dbType = this.detectDatabaseType(extension);
    if (!dbType) {
      this.renderError(`Unsupported file extension: ".${extension}".`);
      return;
    }

    const basePath = this.file?.parent?.path;
    this.dbType = dbType;

    this.table = mount(Table, {
      target: this.contentEl,
      props: {
        dbType,
        basePath,
      },
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
    if (!this.dbType) return;

    let entries: EntryData[];
    try {
      entries = deserializeEntries(data, this.dbType);
    } catch (e) {
      console.error('Citation plugin: failed to parse file', e);
      this.renderError(
        e instanceof Error ? e.message : 'Failed to parse file.',
      );
      return;
    }

    this.table.set(entries);
    this.value = data;
  }

  private getValue() {
    if (!this.dbType || !this.table) {
      return this.value;
    }
    try {
      return serializeEntries(this.table.get(), this.dbType);
    } catch (e) {
      console.error('Citation plugin: failed to serialize entries', e);
      return this.value;
    }
  }

  private renderError(message: string) {
    console.error(message);
  }
}
