import { TextFileView, TFile, WorkspaceLeaf, type IconName } from 'obsidian';
import CitationPlugin from '../main';
import {
  type EntryData,
  type EntryDataBibLaTeX,
  type EntryDataCSL,
  CIT_VIEW_TYPE,
  CIT_ICON,
  type EntryMetadata,
  getEntryMetadata,
} from '../types';
import { fetchEntryById, generateCiteKey, type IdType } from '../fetcher';
import { AddReferenceModal } from '../modals';
import Editor from './Editor.svelte';
import { mount, unmount } from 'svelte';
import type { CitationDatabase } from '../database';

export class EditorView extends TextFileView {
  /** Raw text last loaded from disk (fallback when serialization fails). */
  private value = '';
  /** The database. */
  private db: CitationDatabase | undefined;
  /** True only after entries have been successfully loaded into the table. */
  private loaded = false;
  editor: ReturnType<typeof Editor> | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CitationPlugin,
  ) {
    super(leaf);
  }

  getIcon(): IconName {
    return CIT_ICON;
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
    this.loaded = false;
    this.value = '';
  }

  /*
    execute order: onOpen -> onLoadFile -> setViewData -> onUnloadFile -> onClose
  */

  async onOpen() {
    await super.onOpen();
  }

  async onLoadFile(file: TFile) {
    this.db = this.plugin.registry.acquire(file.path);
    this.editor = mount(Editor, {
      target: this.contentEl,
      props: {
        app: this.app,
        db: this.db,
        getNotePath: (citekey: string) => {
          return this.db.getPathForCitekey(citekey);
        },
        openAddModal: () => {
          new AddReferenceModal(this.app, (idType, id) =>
            this.fetchAndAddEntry(idType, id),
          ).open();
        },
        onChange: () => {
          this.requestSave();
        },
      },
    });

    await super.onLoadFile(file);
  }

  async onUnloadFile(file: TFile) {
    await super.onUnloadFile(file);
    if (this.editor) {
      unmount(this.editor);
    }
    if (this.db) {
      this.plugin.registry.release(file.path);
      this.db = undefined;
    }
  }

  async onClose() {
    await super.onClose();
  }

  private async setValue(data: string) {
    this.value = data;

    if (!this.db || !this.editor) {
      return;
    }

    await this.db.deserialize(data);
    this.loaded = true;
  }

  private getValue() {
    if (!this.loaded || !this.db || !this.editor) {
      return this.value;
    }

    try {
      return this.db.serialize();
    } catch (e) {
      console.error('Citation manager: failed to serialize entries', e);
      return this.value;
    }
  }

  private async fetchAndAddEntry(idType: IdType, id: string) {
    if (!this.db || !this.editor) return;

    const fetched = await fetchEntryById(idType, id);
    if (fetched.length === 0) return;

    for (const entry of fetched) {
      entry.id = generateCiteKey(entry, this.db.ids);
      const adapted = getEntryMetadata(
        entry.id,
        entry,
        this.db.type,
        this.db.dir,
        this.db.vaultPath,
      );
      this.db.add(adapted);
      this.requestSave();
    }
  }
}
