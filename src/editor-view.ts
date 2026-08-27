import { TextFileView, TFile, WorkspaceLeaf, type IconName } from 'obsidian';
import CitationPlugin from './main';
import {
  type DatabaseType,
  Library,
  loadEntries,
  CIT_VIEW_TYPE,
  type FileType,
} from './types';
import Table from './components/Table.svelte';
import { mount, unmount } from 'svelte';

export class EditorView extends TextFileView {
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

  clear(): void {
    console.log('clear');
    // this.contentEl.empty();
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
      if (dbType === 'csl-json') {
        const validationError = this.validateCslJson(data);
        if (validationError) {
          this.renderError(validationError);
          return;
        }
      }
      entries = loadEntries(data, dbType);
    } catch (e) {
      console.error('Citation plugin: failed to parse file', e);
      this.renderError(
        dbType === 'csl-json'
          ? 'This file is not valid CSL-JSON.'
          : 'This file could not be parsed as BibLaTeX.',
      );
      return;
    }

    if (!entries || entries.length === 0) {
      this.renderError(
        dbType === 'csl-json'
          ? 'This file is not valid CSL-JSON.'
          : 'No BibLaTeX entries could be parsed.',
      );
      return;
    }

    const basePath = this.file?.parent?.path;
    const library = new Library(entries, dbType, basePath);

    this.table.set(Object.values(library.entries));
    this.value = data;
  }

  /**
   * Validate that the raw text is a CSL-JSON array where every entry has
   * the required `id` and `type` fields. Returns an error message string,
   * or undefined when the content is valid.
   */
  private validateCslJson(raw: string): string | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'This file is not valid CSL-JSON.';
    }
    if (!Array.isArray(parsed)) {
      return 'This file is not valid CSL-JSON: expected a JSON array.';
    }
    if (parsed.length === 0) {
      return 'This file is not valid CSL-JSON: the array is empty.';
    }
    for (const entry of parsed) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as { id?: unknown }).id !== 'string' ||
        typeof (entry as { type?: unknown }).type !== 'string'
      ) {
        return (
          'This file is not valid CSL-JSON: every entry must have ' +
          'string "id" and "type" fields.'
        );
      }
    }
    return undefined;
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
