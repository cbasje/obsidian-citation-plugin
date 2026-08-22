import {
  FileSystemAdapter,
  MarkdownSourceView,
  MarkdownView,
  Notice,
  normalizePath,
  Plugin,
  TFile,
} from 'obsidian';
import * as path from 'path';
import * as chokidar from 'chokidar';
import * as CodeMirror from 'codemirror';
import {
  compile as compileTemplate,
  TemplateDelegate as Template,
} from 'handlebars';
import CitationEvents from './events';
import {
  InsertCitationModal,
  InsertNoteLinkModal,
  InsertNoteContentModal,
  OpenNoteModal,
} from './modals';
import { VaultExt } from './obsidian-extensions.d';
import { CitationSettingTab, CitationsPluginSettings } from './settings';
import {
  Entry,
  EntryData,
  EntryBibLaTeXAdapter,
  EntryCSLAdapter,
  IIndexable,
  Library,
} from './types';
import {
  DISALLOWED_FILENAME_CHARACTERS_RE,
  Notifier,
  WorkerManager,
  WorkerManagerBlocked,
} from './util';
import { CslItemRegistry } from './csl/registry';
import { CiteprocEngine } from './csl/engine';
import { BUNDLED_LOCALE_EN_US, CslStyleId } from './csl/assets';
import LoadWorker from 'web-worker:./worker';
import type { CitationItem } from 'citeproc';

export default class CitationPlugin extends Plugin {
  settings: CitationsPluginSettings;
  library: Library;

  cslRegistry: CslItemRegistry;
  citeproc: CiteprocEngine;

  // Template compilation options
  private templateSettings = {
    noEscape: true,
  };

  private loadWorker = new WorkerManager(new LoadWorker(), {
    blockingChannel: true,
  });

  events = new CitationEvents();

  loadErrorNotifier = new Notifier(
    'Unable to load citations. Please update Citations plugin settings.',
  );
  literatureNoteErrorNotifier = new Notifier(
    'Unable to access literature note. Please check that the literature note folder exists, or update the Citations plugin settings.',
  );

  get editor(): CodeMirror.Editor {
    const view = this.app.workspace.activeLeaf.view;
    if (!(view instanceof MarkdownView)) return null;

    const sourceView = view.sourceMode;
    return (sourceView as MarkdownSourceView).cmEditor;
  }

  async loadSettings(): Promise<void> {
    this.settings = new CitationsPluginSettings();

    const loadedSettings = await this.loadData();
    if (!loadedSettings) return;

    const toLoad = [
      'citationExportPath',
      'citationExportFormat',
      'literatureNoteTitleTemplate',
      'literatureNoteFolder',
      'literatureNoteContentTemplate',
      'markdownCitationTemplate',
      'alternativeMarkdownCitationTemplate',
      'cslStyle',
      'customCslStylePath',
      'renderInlineCitations',
    ];
    toLoad.forEach((setting) => {
      if (setting in loadedSettings) {
        (this.settings as IIndexable)[setting] = loadedSettings[setting];
      }
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onload(): void {
    this.loadSettings().then(() => this.init());
  }

  async init(): Promise<void> {
    // Initialise CSL registry / engine.
    this.cslRegistry = new CslItemRegistry();
    this.citeproc = new CiteprocEngine(this.cslRegistry);

    if (this.settings.citationExportPath) {
      // Load library for the first time
      this.loadLibrary();

      // Set up a watcher to refresh whenever the export is updated
      try {
        // Wait until files are finished being written before going ahead with
        // the refresh -- here, we request that `change` events be accumulated
        // until nothing shows up for 500 ms
        // TODO magic number
        const watchOptions = {
          awaitWriteFinish: {
            stabilityThreshold: 500,
          },
        };

        chokidar
          .watch(
            this.resolveLibraryPath(this.settings.citationExportPath),
            watchOptions,
          )
          .on('change', () => {
            this.loadLibrary();
          });
      } catch {
        this.loadErrorNotifier.show();
      }
    } else {
      // TODO show warning?
    }

    this.addCommand({
      id: 'open-literature-note',
      name: 'Open literature note',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'o' }],
      callback: () => {
        const modal = new OpenNoteModal(this.app, this);
        modal.open();
      },
    });

    this.addCommand({
      id: 'update-bib-data',
      name: 'Refresh citation database',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'r' }],
      callback: () => {
        this.loadLibrary();
      },
    });

    this.addCommand({
      id: 'insert-citation',
      name: 'Insert literature note link',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'e' }],
      callback: () => {
        const modal = new InsertNoteLinkModal(this.app, this);
        modal.open();
      },
    });

    this.addCommand({
      id: 'insert-literature-note-content',
      name: 'Insert literature note content in the current pane',
      callback: () => {
        const modal = new InsertNoteContentModal(this.app, this);
        modal.open();
      },
    });

    this.addCommand({
      id: 'insert-markdown-citation',
      name: 'Insert Markdown citation',
      callback: () => {
        const modal = new InsertCitationModal(this.app, this);
        modal.open();
      },
    });

    this.addCommand({
      id: 'insert-references-block',
      name: 'Insert references code block',
      callback: () => {
        this.insertReferencesBlock();
      },
    });

    // Render bibliographies dynamically in reading view / live preview.
    this.registerMarkdownCodeBlockProcessor(
      'references',
      async (source, el, ctx) => {
        await this.renderReferencesBlock(source, el, ctx);
      },
    );

    // Replace [@citekey] markers in note text with formatted in-text
    // citations in reading view.
    this.registerMarkdownPostProcessor((el, _ctx) => {
      if (!this.settings.renderInlineCitations) return;
      if (
        !this.citeproc ||
        !this.citeproc.isReady ||
        this.cslRegistry.size === 0
      )
        return;
      this.renderInlineCitationsInElement(el);
    });

    this.addSettingTab(new CitationSettingTab(this.app, this));
  }

  /**
   * Resolve a provided library path, allowing for relative paths rooted at
   * the vault directory.
   */
  resolveLibraryPath(rawPath: string): string {
    const vaultRoot =
      this.app.vault.adapter instanceof FileSystemAdapter
        ? this.app.vault.adapter.getBasePath()
        : '/';
    return path.resolve(vaultRoot, rawPath);
  }

  async loadLibrary(): Promise<Library> {
    console.debug('Citation plugin: Reloading library');
    if (this.settings.citationExportPath) {
      const filePath = this.resolveLibraryPath(
        this.settings.citationExportPath,
      );

      // Unload current library.
      this.events.trigger('library-load-start');
      this.library = null;

      return FileSystemAdapter.readLocalFile(filePath)
        .then((buffer) => {
          // If there is a remaining error message, hide it
          this.loadErrorNotifier.hide();

          // Decode file as UTF-8.
          const dataView = new DataView(buffer);
          const decoder = new TextDecoder('utf8');
          const value = decoder.decode(dataView);

          return this.loadWorker.post({
            databaseRaw: value,
            databaseType: this.settings.citationExportFormat,
          });
        })
        .then((entries: EntryData[]) => {
          let adapter: new (data: EntryData) => Entry;
          let idKey: string;

          switch (this.settings.citationExportFormat) {
            case 'biblatex':
              adapter = EntryBibLaTeXAdapter;
              idKey = 'key';
              break;
            case 'csl-json':
              adapter = EntryCSLAdapter;
              idKey = 'id';
              break;
          }

          this.library = new Library(
            Object.fromEntries(
              entries.map((e) => [(e as IIndexable)[idKey], new adapter(e)]),
            ),
          );
          console.debug(
            `Citation plugin: successfully loaded library with ${this.library.size} entries.`,
          );

          // Feed raw entries into the CSL registry and (re)build the
          // citeproc engine so bibliography rendering reflects the new data.
          this.cslRegistry.load(entries, this.settings.citationExportFormat);
          this.loadCiteprocEngine();

          this.events.trigger('library-load-complete');

          return this.library;
        })
        .catch((e) => {
          if (e instanceof WorkerManagerBlocked) {
            // Silently catch WorkerManager error, which will be thrown if the
            // library is already being loaded
            return;
          }

          console.error(e);
          this.loadErrorNotifier.show();

          return null;
        });
    } else {
      console.warn(
        'Citations plugin: citation export path is not set. Please update plugin settings.',
      );
    }
  }

  /**
   * Returns true iff the library is currently being loaded on the worker thread.
   */
  get isLibraryLoading(): boolean {
    return this.loadWorker.blocked;
  }

  get literatureNoteTitleTemplate(): Template {
    return compileTemplate(
      this.settings.literatureNoteTitleTemplate,
      this.templateSettings,
    );
  }

  get literatureNoteContentTemplate(): Template {
    return compileTemplate(
      this.settings.literatureNoteContentTemplate,
      this.templateSettings,
    );
  }

  get markdownCitationTemplate(): Template {
    return compileTemplate(
      this.settings.markdownCitationTemplate,
      this.templateSettings,
    );
  }

  get alternativeMarkdownCitationTemplate(): Template {
    return compileTemplate(
      this.settings.alternativeMarkdownCitationTemplate,
      this.templateSettings,
    );
  }

  getTitleForCitekey(citekey: string): string {
    const unsafeTitle = this.literatureNoteTitleTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
    return unsafeTitle.replace(DISALLOWED_FILENAME_CHARACTERS_RE, '_');
  }

  getPathForCitekey(citekey: string): string {
    const title = this.getTitleForCitekey(citekey);
    // TODO escape note title
    return path.join(this.settings.literatureNoteFolder, `${title}.md`);
  }

  getInitialContentForCitekey(citekey: string): string {
    return this.literatureNoteContentTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
  }

  getMarkdownCitationForCitekey(citekey: string): string {
    return this.markdownCitationTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
  }

  getAlternativeMarkdownCitationForCitekey(citekey: string): string {
    return this.alternativeMarkdownCitationTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
  }

  /**
   * Run a case-insensitive search for the literature note file corresponding to
   * the given citekey. If no corresponding file is found, create one.
   */
  async getOrCreateLiteratureNoteFile(citekey: string): Promise<TFile> {
    const path = this.getPathForCitekey(citekey);
    const normalizedPath = normalizePath(path);

    let file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file == null) {
      // First try a case-insensitive lookup.
      const matches = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.toLowerCase() == normalizedPath.toLowerCase());
      if (matches.length > 0) {
        file = matches[0];
      } else {
        try {
          file = await this.app.vault.create(
            path,
            this.getInitialContentForCitekey(citekey),
          );
        } catch (exc) {
          this.literatureNoteErrorNotifier.show();
          throw exc;
        }
      }
    }

    return file as TFile;
  }

  async openLiteratureNote(citekey: string, newPane: boolean): Promise<void> {
    this.getOrCreateLiteratureNoteFile(citekey)
      .then((file: TFile) => {
        this.app.workspace.getLeaf(newPane).openFile(file);
      })
      .catch(console.error);
  }

  async insertLiteratureNoteLink(citekey: string): Promise<void> {
    this.getOrCreateLiteratureNoteFile(citekey)
      .then((file: TFile) => {
        const useMarkdown: boolean = (<VaultExt>this.app.vault).getConfig(
          'useMarkdownLinks',
        );
        const title = this.getTitleForCitekey(citekey);

        let linkText: string;
        if (useMarkdown) {
          const uri = encodeURI(
            this.app.metadataCache.fileToLinktext(file, '', false),
          );
          linkText = `[${title}](${uri})`;
        } else {
          linkText = `[[${title}]]`;
        }

        this.editor.replaceSelection(linkText);
      })
      .catch(console.error);
  }

  /**
   * Format literature note content for a given reference and insert in the
   * currently active pane.
   */
  async insertLiteratureNoteContent(citekey: string): Promise<void> {
    const content = this.getInitialContentForCitekey(citekey);
    this.editor.replaceRange(content, this.editor.getCursor());
  }

  async insertMarkdownCitation(
    citekey: string,
    alternative = false,
  ): Promise<void> {
    const func = alternative
      ? this.getAlternativeMarkdownCitationForCitekey
      : this.getMarkdownCitationForCitekey;
    const citation = func.bind(this)(citekey);

    this.editor.replaceRange(citation, this.editor.getCursor());
  }

  /**
   * (Re)build the citeproc engine with the currently selected CSL style and
   * locale. Called on library load and whenever the style setting changes.
   */
  async loadCiteprocEngine(): Promise<void> {
    if (!this.citeproc || !this.cslRegistry) return;

    const styleId = this.settings.cslStyle as CslStyleId;
    let customXml: string | undefined;

    if (this.settings.customCslStylePath) {
      try {
        const resolved = this.resolveLibraryPath(
          this.settings.customCslStylePath,
        );
        const buffer = await FileSystemAdapter.readLocalFile(resolved);
        const dataView = new DataView(buffer);
        customXml = new TextDecoder('utf8').decode(dataView);
      } catch (err) {
        console.warn(
          'Citation plugin: could not load custom CSL style, falling back to bundled style.',
          err,
        );
      }
    }

    this.citeproc.setLocale(BUNDLED_LOCALE_EN_US);
    this.citeproc.configure(styleId, customXml);
  }

  /**
   * Insert an empty `references` fenced code block at the cursor. In reading
   * view it will auto-scan the note for Pandoc-style citations.
   */
  insertReferencesBlock(): void {
    const editor = this.editor;
    if (!editor) {
      new Notice('Open a Markdown note before inserting a references block.');
      return;
    }
    editor.replaceRange('```references\n```', editor.getCursor());
  }

  /**
   * Render a `references` code block as a styled bibliography using
   * citeproc-js. The block contents may be empty (auto-scan the surrounding
   * note for `[@citekey]` markers) or list citekeys one per line.
   */
  async renderReferencesBlock(
    source: string,
    el: HTMLElement,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any,
  ): Promise<void> {
    if (
      !this.citeproc ||
      !this.citeproc.isReady ||
      this.cslRegistry.size === 0
    ) {
      el.createEl('p', {
        text: 'Citation library is not loaded.',
        cls: 'csl-placeholder',
      });
      return;
    }

    // Parse explicit citekeys from the block (one per line, ignoring blanks
    // and comments).
    let citekeys = source
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('<!--'));

    // If the block is empty or starts with "auto", scan the note text.
    if (citekeys.length === 0 || citekeys[0].toLowerCase() === 'auto') {
      const noteFile = this.app.vault.getAbstractFileByPath(
        ctx.sourcePath,
      ) as TFile;
      if (noteFile) {
        const text = await this.app.vault.read(noteFile);
        citekeys = extractCitekeys(text);
      }
    }

    const valid = citekeys.filter((k) => this.cslRegistry.has(k));
    if (valid.length === 0) {
      el.createEl('p', {
        text: 'No citations found.',
        cls: 'csl-placeholder',
      });
      return;
    }

    const entries = this.citeproc.renderBibliography(valid);
    if (entries.length === 0) {
      el.createEl('p', {
        text: 'No bibliography entries could be rendered.',
        cls: 'csl-placeholder',
      });
      return;
    }

    // Render citeproc HTML output safely: build it in a detached container
    // and move the child nodes into the plugin's element. This avoids setting
    // innerHTML directly on a live DOM node (recommended by the Obsidian plugin
    // review guidelines).
    const container = document.createElement('div');
    container.innerHTML = `<div class="csl-bibliography">${entries.join(
      '',
    )}</div>`;
    while (container.firstChild) {
      el.appendChild(container.firstChild);
    }
  }

  /**
   * Walk all text nodes in `el` and replace Pandoc-style `[@citekey]` markers
   * with citeproc-rendered in-text citations. Text inside `<code>` and
   * `<pre>` elements is skipped.
   */
  renderInlineCitationsInElement(el: HTMLElement): void {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Text): number {
        if (!node.nodeValue || !node.nodeValue.includes('[@')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip inline code and code blocks.
        let parent: Element | null = node.parentElement;
        while (parent && parent !== el) {
          if (parent.tagName === 'CODE' || parent.tagName === 'PRE') {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      this.replaceCitationsInTextNode(textNode);
    }
  }

  /**
   * Replace `[@citekey]` markers in a single text node with rendered
   * citation spans. If no valid citations are found the text is left
   * untouched.
   */
  private replaceCitationsInTextNode(textNode: Text): void {
    const text = textNode.nodeValue;
    if (!text) return;

    // Match bracketed Pandoc citations: [@citekey], [-@citekey],
    // [@citekey, p. 5], [@a; @b], etc.
    const pattern = /\[(-?@[^\]]+)\]/g;
    const matches = Array.from(text.matchAll(pattern));
    if (matches.length === 0) return;

    const parent = textNode.parentNode;
    if (!parent) return;

    let lastIndex = 0;
    for (const match of matches) {
      const matchStart = match.index!;
      const matchEnd = matchStart + match[0].length;

      // Text before the citation.
      if (matchStart > lastIndex) {
        parent.insertBefore(
          document.createTextNode(text.substring(lastIndex, matchStart)),
          textNode,
        );
      }

      const items = parseCitationGroup(match[1]);
      if (items && items.length > 0) {
        const html = this.citeproc.renderInlineCitation(items);
        if (html) {
          const span = document.createElement('span');
          span.className = 'csl-inline';
          const temp = document.createElement('span');
          temp.innerHTML = html;
          while (temp.firstChild) {
            span.appendChild(temp.firstChild);
          }
          parent.insertBefore(span, textNode);
        } else {
          // Rendering failed — keep the original marker.
          parent.insertBefore(document.createTextNode(match[0]), textNode);
        }
      } else {
        // Not a valid citation — keep the original text.
        parent.insertBefore(document.createTextNode(match[0]), textNode);
      }

      lastIndex = matchEnd;
    }

    // Remaining text after the last citation.
    if (lastIndex < text.length) {
      parent.insertBefore(
        document.createTextNode(text.substring(lastIndex)),
        textNode,
      );
    }

    parent.removeChild(textNode);
  }
}

/**
 * Extract Pandoc-style citekeys (`[@citekey]`, `@citekey`, `[-@citekey]`)
 * from a block of text, preserving order of first appearance.
 */
function extractCitekeys(text: string): string[] {
  const pattern = /\[-?@([^\]\s]+)\]|@([A-Za-z0-9_:-]+)/g;
  const seen = new Set<string>();
  let match: RegExpExecArray;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1] || match[2];
    if (key) seen.add(key);
  }
  return Array.from(seen);
}

/**
 * Parse the contents of a bracketed Pandoc citation (the text inside `[@...]`)
 * into an array of citeproc `CitationItem`s.
 *
 * Examples:
 *   "@smith2020"                         → [{id:"smith2020"}]
 *   "-@smith2020"                        → [{id:"smith2020","suppress-author":true}]
 *   "@smith2020, p. 5"                   → [{id:"smith2020",locator:"p. 5"}]
 *   "@smith2020; @jones2019"             → [{id:"smith2020"},{id:"jones2019"}]
 *
 * Returns `null` if the content does not parse as a valid citation group.
 */
function parseCitationGroup(content: string): CitationItem[] | null {
  const parts = content.split(';').map((s) => s.trim());
  const items: CitationItem[] = [];

  for (const part of parts) {
    const m = part.match(/^(-?)@([^\s,]+)(?:\s*,\s*(.+))?$/);
    if (!m) return null;

    const [, suppress, citekey, locator] = m;
    const item: CitationItem = { id: citekey };
    if (suppress) item['suppress-author'] = true;
    if (locator) item.locator = locator.trim();
    items.push(item);
  }

  return items.length > 0 ? items : null;
}
