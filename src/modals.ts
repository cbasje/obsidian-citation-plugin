import {
  App,
  type EventRef,
  type FuzzyMatch,
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  renderMatches,
  type SearchMatches,
  type SearchMatchPart,
} from 'obsidian';
import CitationPlugin from './main';
import type { EntryMetadata } from './types';
import { ID_TYPES, type IdType } from './fetcher';

// Stub some methods we know are there..
interface FuzzySuggestModalExt<T> extends FuzzySuggestModal<T> {
  chooser: ChooserExt;
}
interface ChooserExt {
  useSelectedItem(evt: MouseEvent | KeyboardEvent): void;
}

class SearchModal extends FuzzySuggestModal<EntryMetadata> {
  plugin: CitationPlugin;
  limit = 50;

  loadingEl: HTMLElement | undefined;

  eventRefs: EventRef[] = [];

  constructor(app: App, plugin: CitationPlugin) {
    super(app);
    this.plugin = plugin;

    this.resultContainerEl.addClass('zoteroModalResults');

    this.inputEl.setAttribute('spellcheck', 'false');

    this.loadingEl = this.resultContainerEl.parentElement?.createEl('div', {
      cls: 'zoteroModalLoading',
    });
    this.loadingEl?.createEl('div', { cls: 'zoteroModalLoadingAnimation' });
    this.loadingEl?.createEl('p', {
      text: 'Loading citation database. Please wait...',
    });
  }

  onOpen() {
    super.onOpen();

    this.eventRefs = [
      this.plugin.events.on('library-load-start', () => {
        this.setLoading(true);
      }),

      this.plugin.events.on('library-load-complete', () => {
        this.setLoading(false);
      }),
    ];

    this.setLoading(this.plugin.isLibraryLoading);

    // Don't immediately register keyevent listeners. If the modal was triggered
    // by an "Enter" keystroke (e.g. via the Obsidian command dialog), this event
    // will be received here erroneously.
    setTimeout(() => {
      this.inputEl.addEventListener('keydown', (ev) => this.onInputKeydown(ev));
      this.inputEl.addEventListener('keyup', (ev) => this.onInputKeyup(ev));
    }, 200);
  }

  onClose() {
    this.eventRefs?.forEach((e) => this.plugin.events.offref(e));
  }

  getItems(): EntryMetadata[] {
    if (!this.plugin.library || this.plugin.isLibraryLoading) {
      return [];
    }

    return Object.values(this.plugin.library.entries);
  }

  getItemText(item: EntryMetadata): string {
    return `${item.title} ${item.authorString} ${item.year}`;
  }

  setLoading(loading: boolean): void {
    if (loading) {
      this.loadingEl?.removeClass('d-none');
      this.inputEl.disabled = true;
      this.resultContainerEl.empty();
    } else {
      this.loadingEl?.addClass('d-none');
      this.inputEl.disabled = false;
      this.inputEl.focus();

      // updateSuggestions is not exposed in the public API.

      (this as any).updateSuggestions();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onChooseItem(item: EntryMetadata, evt: MouseEvent | KeyboardEvent): void {
    this.plugin.openLiteratureNote(item.id, false).catch(console.error);
  }

  renderSuggestion(match: FuzzyMatch<EntryMetadata>, el: HTMLElement): void {
    el.empty();
    const entry = match.item;
    const entryTitle = entry.title || '';

    const container = el.createEl('div', { cls: 'zoteroResult' });
    const titleEl = container.createEl('span', {
      cls: 'zoteroTitle',
    });
    container.createEl('span', { cls: 'zoteroCitekey', text: entry.id });

    const authorsCls = entry.authorString
      ? 'zoteroAuthors'
      : 'zoteroAuthors zoteroAuthorsEmpty';
    const authorsEl = container.createEl('span', {
      cls: authorsCls,
    });

    // Prepare to highlight string matches for each part of the search item.
    // Compute offsets of each rendered element's content within the string
    // returned by `getItemText`.
    const allMatches = match.match.matches;
    const authorStringOffset = 1 + entryTitle.length;

    // Filter a match list to contain only the relevant matches for a given
    // substring, and with match indices shifted relative to the start of that
    // substring
    const shiftMatches = (
      matches: SearchMatches,
      start: number,
      end: number,
    ) => {
      return matches
        .map((match: SearchMatchPart) => {
          const [matchStart, matchEnd] = match;
          return [
            matchStart - start,
            Math.min(matchEnd - start, end),
          ] as SearchMatchPart;
        })
        .filter((match: SearchMatchPart) => {
          const [matchStart] = match;
          return matchStart >= 0;
        });
    };

    // Now highlight matched strings within each element
    renderMatches(
      titleEl,
      entryTitle,
      shiftMatches(allMatches, 0, entryTitle.length),
    );
    if (entry.authorString) {
      renderMatches(
        authorsEl,
        entry.authorString,
        shiftMatches(
          allMatches,
          authorStringOffset,
          authorStringOffset + entry.authorString.length,
        ),
      );
    }
  }

  onInputKeydown(ev: KeyboardEvent) {
    if (ev.key == 'Tab') {
      ev.preventDefault();
    }
  }

  onInputKeyup(ev: KeyboardEvent) {
    if (ev.key == 'Enter' || ev.key == 'Tab') {
      (
        this as unknown as FuzzySuggestModalExt<EntryMetadata>
      ).chooser.useSelectedItem(ev);
    }
  }
}

export class OpenNoteModal extends SearchModal {
  constructor(app: App, plugin: CitationPlugin) {
    super(app, plugin);

    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open literature note' },
      { command: 'ctrl ↵', purpose: 'to open literature note in a new pane' },
      { command: 'tab', purpose: 'open in Zotero' },
      { command: 'shift tab', purpose: 'open PDF' },
      { command: 'esc', purpose: 'to dismiss' },
    ]);
  }

  onChooseItem(item: EntryMetadata, evt: MouseEvent | KeyboardEvent): void {
    if (evt instanceof MouseEvent || evt.key == 'Enter') {
      const newPane =
        evt instanceof KeyboardEvent && (evt as KeyboardEvent).ctrlKey;
      this.plugin.openLiteratureNote(item.id, newPane);
    } else if (evt.key == 'Tab') {
      if (evt.shiftKey) {
        const files = item.files || [];
        const firstFile = files.at(0);
        if (!firstFile) {
          new Notice('This reference has no associated PDF files.');
        } else if (firstFile.startsWith('[[') && firstFile.endsWith(']]')) {
          const path = firstFile.slice(2, -2).split('/');
          const fileName = path.pop();
          if (!fileName) return;
          this.app.workspace.openLinkText(
            fileName,
            path?.join('/') ?? '/',
            true,
          );
        } else if (firstFile.endsWith('.pdf')) {
          open(`file://${firstFile}`);
        }
      } else {
        open(item.zoteroSelectURI);
      }
    }
  }
}

export class InsertCitationModal extends SearchModal {
  constructor(app: App, plugin: CitationPlugin) {
    super(app, plugin);

    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to insert Markdown citation' },
      { command: 'esc', purpose: 'to dismiss' },
    ]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onChooseItem(item: EntryMetadata, evt: MouseEvent | KeyboardEvent): void {
    this.plugin.insertMarkdownCitation(item.id).catch(console.error);
  }
}

export class AddReferenceModal extends Modal {
  private idType: IdType = 'DOI';
  private idValue = '';
  private submitBtn: HTMLButtonElement | undefined;

  constructor(
    app: App,
    private onSubmit: (idType: IdType, id: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Add reference' });

    new Setting(contentEl).setName('Identifier type').addDropdown((dropdown) =>
      dropdown
        .addOptions(
          Object.fromEntries(ID_TYPES.map((t) => [t.value, t.label])) as Record<
            string,
            string
          >,
        )
        .setValue(this.idType)
        .onChange((value) => {
          this.idType = value as IdType;
          this.updatePlaceholder();
        }),
    );

    new Setting(contentEl)
      .setName('Identifier')
      .setDesc('Enter the identifier for the reference you want to fetch.')
      .addText((text) => {
        text.inputEl.addClass('citation-add-id-input');
        text.onChange((value) => {
          this.idValue = value;
          this.updateSubmitState();
        });
        // Store reference for placeholder updates
        (this as { idInputEl?: HTMLInputElement }).idInputEl = text.inputEl;
        this.updatePlaceholder();
      });

    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText('Fetch and add').setClass('mod-cta');
      btn.buttonEl.addClass('citation-add-submit');
      this.submitBtn = btn.buttonEl;
      btn.onClick(() => this.submit());
      this.updateSubmitState();
    });
  }

  private updatePlaceholder() {
    const inputEl = (this as { idInputEl?: HTMLInputElement }).idInputEl;
    if (!inputEl) return;
    const config = ID_TYPES.find((t) => t.value === this.idType);
    inputEl.placeholder = config?.placeholder ?? '';
  }

  private updateSubmitState() {
    if (!this.submitBtn) return;
    this.submitBtn.disabled = this.idValue.trim().length === 0;
  }

  private async submit() {
    if (!this.submitBtn) return;
    const id = this.idValue.trim();
    if (!id) return;

    this.submitBtn.disabled = true;
    this.submitBtn.textContent = 'Fetching…';

    try {
      await this.onSubmit(this.idType, id);
      this.close();
    } catch (e) {
      console.error('Citation plugin: add reference failed', e);
      new Notice(
        e instanceof Error ? e.message : 'Failed to fetch reference.',
        5000,
      );
      this.submitBtn.disabled = false;
      this.submitBtn.textContent = 'Fetch and add';
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
