import {
  Editor,
  MarkdownView,
  Notice,
  normalizePath,
  Plugin,
  TFile,
  TFolder,
} from 'obsidian';
import {
  compile as compileTemplate,
  type TemplateDelegate as Template,
} from 'handlebars';
import CitationEvents from './events';
import { InsertCitationModal, OpenNoteModal } from './modals';
import { CitationSettingTab, CitationsPluginSettings } from './settings';
import { fileTypes, type IIndexable, CIT_VIEW_TYPE, CIT_ICON } from './types';
import { DISALLOWED_FILENAME_CHARACTERS_RE } from './util';
import type { CitationItem } from 'citeproc';
import { EditorView } from './editor/editor-view';
import { buildInlineCitationExtension } from './citations/extension';
import { parseCitationGroup } from './citations/parse';
import { StatusBarCounter } from './status-bar';
import { CitationDatabase } from './database';
import { ReferencesBlockView } from './references/references';

export function getMarkdownCitationForCitekey(citekey: string): string {
  return `[@${citekey}]`;
}

export default class CitationPlugin extends Plugin {
  settings = new CitationsPluginSettings();
  events = new CitationEvents();

  db: CitationDatabase | undefined;

  // Template compilation options
  private templateSettings = {
    noEscape: true,
  };

  get editor(): Editor | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? view.editor : null;
  }

  async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData();
    if (!loadedSettings) return;

    const toLoad = [
      'citationExportPath',
      'literatureNoteTitleTemplate',
      'literatureNoteFolder',
      'literatureNoteContentTemplate',
      'cslStyle',
      'customCslStylePath',
      'cslLanguage',
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

  async loadDatabase() {
    try {
      console.debug('loadDatabase');
      await this.db.load();
    } catch (e) {
      new Notice(
        e instanceof Error
          ? e.message
          : 'Unable to load citations. Please update Citations manager settings.',
      );
    }
  }

  async onload(): Promise<void> {
    console.debug(`Loading ${CIT_VIEW_TYPE} plugin`);

    await this.loadSettings();
    console.debug('SETTING', this.settings);

    // Editor extension: render `[@citekey]` markers as formatted in-text
    // citations in Live Preview via CodeMirror Decorations. Re-registering
    // is idempotent (Obsidian dedupes per plugin).
    this.registerEditorExtension(buildInlineCitationExtension(this));

    // Status-bar counter for inline citations (driven by the
    // `inline-citations-changed` event from the editor extension).
    const counter = new StatusBarCounter(this);
    counter.register();

    if (this.settings.citationExportPath) {
      this.db = new CitationDatabase(this.settings.citationExportPath, this);
      this.loadDatabase();

      this.registerEvent(
        this.app.vault.on('modify', (file) => {
          // Watch for changes to the library file
          if (file.path === this.settings.citationExportPath) {
            this.loadDatabase();
            return;
          }
        }),
      );
    }

    // Customize the file menu
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
        if (source === 'link-context-menu') return;

        // Add a menu item to the folder context menu to create a board
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setSection('action-primary')
              .setTitle('New citation database')
              .setIcon(CIT_ICON)
              .onClick(() => this.newDatabaseFile(file));
          });
          return;
        }
      }),
    );

    this.addRibbonIcon(CIT_ICON, 'Create new citation database', () => {
      this.newDatabaseFile();
    });

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
        this.loadDatabase();
      },
    });

    this.addCommand({
      id: 'insert-markdown-citation',
      name: 'Insert citation',
      callback: () => {
        const modal = new InsertCitationModal(this.app, this);
        modal.open();
      },
    });

    this.addCommand({
      id: 'insert-references-block',
      name: 'Insert references block',
      callback: () => {
        ReferencesBlockView.insert(this.editor);
      },
    });

    // Render bibliographies dynamically in reading view / live preview.
    this.registerMarkdownCodeBlockProcessor(
      'references',
      async (source, el, ctx) => {
        const child = new ReferencesBlockView(el, this);
        ctx.addChild(child);
        await child.init(source, ctx.sourcePath);
      },
    );

    // Replace [@citekey] markers in note text with formatted in-text
    // citations in reading view.
    this.registerMarkdownPostProcessor((el, _ctx) => {
      if (!this.settings.renderInlineCitations) return;
      this.renderInlineCitationsInElement(el);
    });

    this.addSettingTab(new CitationSettingTab(this.app, this));

    this.registerExtensions(fileTypes as unknown as string[], CIT_VIEW_TYPE);
    this.registerView(CIT_VIEW_TYPE, (leaf) => new EditorView(leaf, this));
  }

  async newDatabaseFile(folder?: TFolder) {
    const targetFolder = folder
      ? folder
      : this.app.fileManager.getNewFileParent(
        this.app.workspace.getActiveFile()?.path || '',
      );

    try {
      const targetPath = targetFolder.path + '/Untitled.bib';
      const createdFile = await this.app.vault.create(targetPath, '');

      await this.app.workspace.getLeaf().setViewState({
        type: CIT_VIEW_TYPE,
        state: { file: createdFile.path },
      });
    } catch (e) {
      console.error('Error creating new citation database:', e);
    }
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
      this.db.getTemplateVariablesForCitekey(citekey),
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
      this.db.getTemplateVariablesForCitekey(citekey),
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
    const rendered = this.db.renderInlineCitationsBatch(
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
