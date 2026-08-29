import { Editor, Notice, MarkdownRenderChild } from 'obsidian';
import References from './References.svelte';
import { mount, unmount } from 'svelte';
import type { CitationDatabase } from '../database';
import { extractCitekeys } from '../citations/parse';
import type CitationPlugin from '../main';

export class ReferencesBlockView extends MarkdownRenderChild {
  /** The database. */
  private db: CitationDatabase | undefined;
  private block: ReturnType<typeof References> | undefined;

  constructor(
    private container: HTMLElement,
    private plugin: CitationPlugin,
  ) {
    super(container);
    this.db = plugin.db;
  }

  public onload(): void {
    this.block = mount(References, {
      target: this.container,
      props: {
        db: this.db,
      },
    });
  }

  public onunload(): void {
    if (this.block) {
      unmount(this.block);
    }
  }

  /**
   * Insert an empty `references` fenced code block at the cursor. In reading
   * view it will auto-scan the note for Pandoc-style citations.
   */
  static insert(editor: Editor): void {
    if (!editor) {
      new Notice('Open a Markdown note before inserting a references block.');
      return;
    }
    editor.replaceRange('```references\n\n```', editor.getCursor());
  }

  async init(source: string, path: string): Promise<void> {
    // Parse explicit citekeys from the block (one per line, ignoring blanks
    // and comments).
    const citekeys = source
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('<!--'));

    // If the block is empty or starts with "auto", scan the note text.
    if (citekeys.length === 0 || citekeys[0].toLowerCase() === 'auto') {
      const noteFile = this.plugin.app.vault.getFileByPath(path);
      if (noteFile) {
        const text = await this.plugin.app.vault.read(noteFile);
        this.block?.setCitekeys(extractCitekeys(text));
      }
    }
  }
}
