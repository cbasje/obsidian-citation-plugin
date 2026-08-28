import {
  Editor,
  MarkdownView,
  Notice,
  normalizePath,
  Plugin,
  TFile,
} from 'obsidian';
import {
  compile as compileTemplate,
  type TemplateDelegate as Template,
} from 'handlebars';
import CitationEvents from './events';
import { InsertCitationModal, OpenNoteModal } from './modals';
import { CitationSettingTab, CitationsPluginSettings } from './settings';
import {
  fileTypes,
  type IIndexable,
  Library,
  CIT_VIEW_TYPE,
  CIT_ICON,
  getFileType,
} from './types';
import { deserializeEntries } from './serializer';
import { DISALLOWED_FILENAME_CHARACTERS_RE } from './util';
import { CslItemRegistry } from './csl/registry';
import { CiteprocEngine } from './csl/engine';
import { BUNDLED_LOCALE_EN_US, type CslStyleId } from './csl/assets';
import type { CitationItem } from 'citeproc';
import { EditorView } from './editor-view';
import { buildInlineCitationExtension } from './citations/extension';
import { extractCitekeys, parseCitationGroup } from './citations/parse';
import { StatusBarCounter } from './status-bar';

export function getMarkdownCitationForCitekey(citekey: string): string {
  return `[@${citekey}]`;
}

export default class CitationPlugin extends Plugin {
  settings = new CitationsPluginSettings();
  library: Library | null = null;

  cslRegistry: CslItemRegistry;
  citeproc: CiteprocEngine;

  private isLoading = false;

  // Template compilation options
  private templateSettings = {
    noEscape: true,
  };

  events = new CitationEvents();

  get editor(): Editor | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? view.editor : null;
  }

  async loadSettings(): Promise<void> {
    this.settings = new CitationsPluginSettings();

    const loadedSettings = await this.loadData();
    if (!loadedSettings) return;

    const toLoad = [
      'citationExportPath',
      'literatureNoteTitleTemplate',
      'literatureNoteFolder',
      'literatureNoteContentTemplate',
      'cslStyle',
      'customCslStylePath',
      'renderInlineCitations',
    ];
    toLoad.forEach((setting) => {
      if (setting in loadedSettings) {
        (this.settings as IIndexable)[setting] = loadedSettings[setting];
      }
    });

    // Canonicalize path-like settings so they compare cleanly against
    // Obsidian's normalized TFile.path in the vault 'modify' handler.
    // normalizePath() handles slashes and trailing slashes but does NOT
    // strip a leading "./", so we do that explicitly here.
    const pathKeys = [
      'citationExportPath',
      'customCslStylePath',
      'literatureNoteFolder',
    ];
    pathKeys.forEach((key) => {
      const v = (this.settings as IIndexable)[key];
      if (typeof v === 'string' && v.length > 0) {
        (this.settings as IIndexable)[key] = normalizePath(
          v.replace(/^\.\/+/, ''),
        );
      }
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    this.init();
  }

  async init(): Promise<void> {
    // Initialise CSL registry / engine.
    this.cslRegistry = new CslItemRegistry();
    this.citeproc = new CiteprocEngine(this.cslRegistry);

    // Editor extension: render `[@citekey]` markers as formatted in-text
    // citations in Live Preview via CodeMirror Decorations. Re-registering
    // is idempotent (Obsidian dedupes per plugin).
    this.registerEditorExtension(buildInlineCitationExtension(this));

    // Status-bar counter for inline citations (driven by the
    // `inline-citations-changed` event from the editor extension).
    const counter = new StatusBarCounter(this);
    counter.register();

    if (this.settings.citationExportPath) {
      this.loadLibrary();

      // Watch for changes to the library file using Obsidian's vault API.
      this.registerEvent(
        this.app.vault.on('modify', (file) => {
          if (file.path === this.settings.citationExportPath) {
            this.loadLibrary();
          }
        }),
      );
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

    this.registerExtensions(fileTypes as unknown as string[], CIT_VIEW_TYPE);
    this.registerView(CIT_VIEW_TYPE, (leaf) => new EditorView(leaf, this));
  }

  /**
   * Get the vault-relative directory of the citation database file, used for
   * resolving relative file paths in `file` fields.
   */
  private getLibraryDir(): string {
    const p = this.settings.citationExportPath;
    const lastSlash = p.lastIndexOf('/');
    return lastSlash >= 0 ? p.substring(0, lastSlash) : '';
  }

  async loadLibrary(): Promise<Library | null> {
    console.debug('Citation plugin: Reloading library');
    if (!this.settings.citationExportPath) {
      console.warn(
        'Citations plugin: citation export path is not set. Please update plugin settings.',
      );
      return null;
    }

    if (this.isLoading) return null;
    this.isLoading = true;

    // Unload current library.
    this.events.trigger('library-load-start');
    this.library = null;

    try {
      const file = this.app.vault.getFileByPath(
        this.settings.citationExportPath,
      );
      const extension = getFileType(file);
      const raw = await this.app.vault.cachedRead(file);

      const entries = deserializeEntries(raw, extension);

      this.library = new Library(entries, extension, this.getLibraryDir());
      this.paths = Object.values(entries).map((entry) =>
        this.getPathForCitekey(this.getLibraryDir(), entry.id),
      );
      console.debug(
        `Citation plugin: successfully loaded library with ${this.library.size} entries.`,
      );

      // Feed raw entries into the CSL registry and (re)build the citeproc
      // engine so bibliography rendering reflects the new data.
      this.cslRegistry.load(entries);
      await this.loadCiteprocEngine();

      this.events.trigger('library-load-complete');
      return this.library;
    } catch (e) {
      console.error(e);
      new Notice(
        e instanceof Error
          ? e.message
          : 'Unable to load citations. Please update Citations plugin settings.',
      );
      return null;
    } finally {
      this.isLoading = false;
    }
  }

  get isLibraryLoading(): boolean {
    return this.isLoading;
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

  getTitleForCitekey(citekey: string): string {
    const unsafeTitle = this.literatureNoteTitleTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
    return unsafeTitle.replace(DISALLOWED_FILENAME_CHARACTERS_RE, '_');
  }

  getPathForCitekey(basePath: string, citekey: string): string {
    const title = this.getTitleForCitekey(citekey);
    const notesFolder = this.settings.literatureNoteFolder || 'Reading notes';
    const notesSep = notesFolder && !notesFolder.endsWith('/') ? '/' : '';

    const parentFolder = basePath;
    const parentSep = parentFolder && !parentFolder.endsWith('/') ? '/' : '';

    return normalizePath(
      `${parentFolder}${parentSep}${notesFolder}${notesSep}${title}.md`,
    );
  }

  getInitialContentForCitekey(citekey: string): string {
    return this.literatureNoteContentTemplate(
      this.library.getTemplateVariablesForCitekey(citekey),
    );
  }

  /**
   * Run a case-insensitive search for the literature note file corresponding to
   * the given citekey. If no corresponding file is found, create one.
   */
  async getOrCreateLiteratureNoteFile(
    basePath: string,
    citekey: string,
  ): Promise<TFile> {
    const notePath = this.getPathForCitekey(basePath, citekey);

    let file = this.app.vault.getAbstractFileByPath(notePath);
    if (file == null) {
      // First try a case-insensitive lookup.
      const matches = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.toLowerCase() == notePath.toLowerCase());
      if (matches.length > 0) {
        file = matches[0];
      } else {
        try {
          file = await this.app.vault.create(
            notePath,
            this.getInitialContentForCitekey(citekey),
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
    const source = this.app.vault.getFileByPath(
      this.settings.citationExportPath,
    );
    this.getOrCreateLiteratureNoteFile(source.parent.path, citekey)
      .then((file: TFile) => {
        this.app.workspace.getLeaf(newPane).openFile(file);
      })
      .catch(console.error);
  }

  async insertMarkdownCitation(citekey: string): Promise<void> {
    const editor = this.editor;
    if (!editor) return;
    const citation = getMarkdownCitationForCitekey(citekey);
    editor.replaceRange(citation, editor.getCursor());
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
        customXml = await this.app.vault.adapter.read(
          this.settings.customCslStylePath,
        );
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
    editor.replaceRange('```references\n\n```', editor.getCursor());
  }

  /**
   * Render a `references` code block as a styled bibliography using
   * citeproc-js. The block contents may be empty (auto-scan the surrounding
   * note for `[@citekey]` markers) or list citekeys one per line.
   */
  async renderReferencesBlock(
    source: string,
    el: HTMLElement,
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
   *
   * All citations in the element are collected in document order and rendered
   * as a batch so numeric styles (e.g. IEEE) assign correct citation numbers.
   */
  renderInlineCitationsInElement(el: HTMLElement): void {
    // Pass 1: collect all text nodes containing [@ markers.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Text): number {
        if (!node.nodeValue || !node.nodeValue.includes('[@')) {
          return NodeFilter.FILTER_REJECT;
        }
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

    // Pass 2: collect all parsed citations in document order.
    interface CollectedCitation {
      textNode: Text;
      match: RegExpMatchArray;
      items: CitationItem[];
    }

    const allCitations: CollectedCitation[] = [];

    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!text) continue;

      const pattern = /\[(-?@[^\]]+)\]/g;
      const matches = Array.from(text.matchAll(pattern));
      for (const match of matches) {
        const items = parseCitationGroup(match[1]);
        if (items && items.length > 0) {
          allCitations.push({ textNode, match, items });
        }
      }
    }

    if (allCitations.length === 0) return;

    // Pass 3: render all citations as a batch (assigns correct numbers for
    // numeric styles like IEEE).
    const rendered = this.citeproc.renderInlineCitationsBatch(
      allCitations.map((c) => c.items),
    );

    // Pass 4: replace markers in the DOM, grouping by text node.
    const nodesToProcess = Array.from(new Set(textNodes));
    for (const textNode of nodesToProcess) {
      const nodeCitations = allCitations
        .map((c, i) => ({ ...c, rendered: rendered[i] }))
        .filter((c) => c.textNode === textNode);
      if (nodeCitations.length === 0) continue;

      const text = textNode.nodeValue;
      if (!text) continue;

      const parent = textNode.parentNode;
      if (!parent) continue;

      let lastIndex = 0;
      for (const cit of nodeCitations) {
        const matchStart = cit.match.index!;
        const matchEnd = matchStart + cit.match[0].length;

        // Text before the citation.
        if (matchStart > lastIndex) {
          parent.insertBefore(
            document.createTextNode(text.substring(lastIndex, matchStart)),
            textNode,
          );
        }

        if (cit.rendered) {
          const span = document.createElement('span');
          span.className = 'csl-inline';
          const temp = document.createElement('span');
          temp.innerHTML = cit.rendered;
          while (temp.firstChild) {
            span.appendChild(temp.firstChild);
          }
          parent.insertBefore(span, textNode);
        } else {
          // Rendering failed — keep the original marker.
          parent.insertBefore(document.createTextNode(cit.match[0]), textNode);
        }

        lastIndex = matchEnd;
      }

      // Remaining text after the last citation in this text node.
      if (lastIndex < text.length) {
        parent.insertBefore(
          document.createTextNode(text.substring(lastIndex)),
          textNode,
        );
      }

      parent.removeChild(textNode);
    }
  }
}
