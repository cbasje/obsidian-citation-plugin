import {
  AbstractTextComponent,
  App,
  DropdownComponent,
  PluginSettingTab,
  Setting,
} from 'obsidian';
import CitationPlugin from './main';
import { type IIndexable, TEMPLATE_VARIABLES } from './types';
import {
  CSL_LANGS,
  CSL_STYLES,
  type CSL_LANG,
  type CSL_STYLE_ID,
} from './csl/assets';

export class CitationsPluginSettings {
  public citationExportPath: string = '';

  literatureNoteTitleTemplate = '@{{ citekey }}';
  literatureNoteFolder = 'Reading notes';
  literatureNoteContentTemplate = `---
authors:
{{ authors | list | indent:2 }}
date: {{ date }}
{% if files %}files:
{{ files | file_link | list | indent:2 }}
{% endif %}---
{{ title | h1 }}`;

  cslStyle: CSL_STYLE_ID | 'custom' = 'apa';
  customCslStylePath = '';
  cslLanguage: CSL_LANG | string = 'en-US';
  syncNotesToDatabase = false;
}

export class CitationSettingTab extends PluginSettingTab {
  private plugin: CitationPlugin;

  citationPathLoadingEl: HTMLElement | undefined;
  citationPathErrorEl: HTMLElement | undefined;
  citationPathSuccessEl: HTMLElement | undefined;

  constructor(app: App, plugin: CitationPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  open(): void {
    // @ts-expect-error This does exist
    super.open();
    this.checkCitationExportPath(this.plugin.settings.citationExportPath).then(
      () => this.showCitationExportPathSuccess(),
    );
  }

  addValueChangeCallback<T extends HTMLTextAreaElement | HTMLInputElement>(
    component: AbstractTextComponent<T> | DropdownComponent,
    settingsKey: string,
    cb?: (value: string) => void,
  ): void {
    component.onChange(async (value) => {
      (this.plugin.settings as IIndexable)[settingsKey] = value;
      this.plugin.saveSettings().then(() => {
        if (cb) {
          cb(value);
        }
      });
    });
  }

  buildValueInput<T extends HTMLTextAreaElement | HTMLInputElement>(
    component: AbstractTextComponent<T> | DropdownComponent,
    settingsKey: string,
    cb?: (value: string) => void,
  ): void {
    component.setValue((this.plugin.settings as IIndexable)[settingsKey]);
    this.addValueChangeCallback(component, settingsKey, cb);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.setAttr('id', 'zoteroSettingTab');

    containerEl.createEl('h2', { text: 'Citation manager settings' });

    const supportedFiles = Array.from(this.plugin.registry.paths)
      .sort()
      .reduce(
        (obj, path) => {
          obj[path] = path;
          return obj;
        },
        {} as Record<string, string>,
      );
    console.debug(
      `Citation manager: loaded ${this.plugin.registry.paths.size}`,
      supportedFiles,
    );

    // NB: we force reload the library on path change.
    new Setting(containerEl)
      .setName('Default citation database')
      .setDesc(
        'Path to the default citation database (.bib, .ris or .json files) to use with the plugin. ' +
        'If you export the database from your reference manager, make sure it is inside the vault. ' +
        'Citations will be automatically reloaded whenever this file updates.',
      )
      .addDropdown((component) =>
        this.buildValueInput(
          component.addOptions(supportedFiles),
          'citationExportPath',
          (value) => {
            this.checkCitationExportPath(value).then((success) => {
              if (success) {
                this.plugin.registry.setMain(value);
                this.plugin
                  .loadDatabase()
                  .then(() => this.showCitationExportPathSuccess());
              }
            });
          },
        ),
      )
      .addButton((button) =>
        button.setButtonText('(Re)load database').onClick(() => {
          this.plugin
            .loadDatabase()
            .then(() => this.showCitationExportPathSuccess());
        }),
      );

    this.citationPathLoadingEl = containerEl.createEl('p', {
      cls: 'zoteroSettingCitationPathLoading d-none',
      text: 'Loading citation database...',
    });
    this.citationPathErrorEl = containerEl.createEl('p', {
      cls: 'zoteroSettingCitationPathError d-none',
      text: 'The citation export file cannot be found. Please check the path above.',
    });
    this.citationPathSuccessEl = containerEl.createEl('p', {
      cls: 'zoteroSettingCitationPathSuccess d-none',
      text: 'Loaded library with {{n}} references.',
    });

    containerEl.createEl('h3', { text: 'Template settings' });
    const templateInstructionsEl = containerEl.createEl('p');
    templateInstructionsEl.append(
      createSpan({
        text:
          'The following settings determine how the notes and links created by ' +
          'the plugin will be rendered. You may specify a custom template for ' +
          'each type of content. Templates are interpreted using ',
      }),
    );
    templateInstructionsEl.append(
      createEl('a', {
        text: 'Knap',
        href: 'https://knap.md/',
      }),
    );
    templateInstructionsEl.append(
      createSpan({
        text:
          ' syntax (also used by Obsidian Web Clipper and Importer). ' +
          'You can make reference to the following variables:',
      }),
    );

    const templateVariableUl = containerEl.createEl('ul', {
      attr: { id: 'citationTemplateVariables' },
    });
    Object.entries(TEMPLATE_VARIABLES).forEach((variableData) => {
      const [key, description] = variableData,
        templateVariableItem = templateVariableUl.createEl('li');

      templateVariableItem.createEl('span', {
        cls: 'text-monospace',
        text: '{{' + key + '}}',
      });

      templateVariableItem.createEl('span', {
        text: description ? ` — ${description}` : '',
      });
    });

    const templateEntryInstructionsEl = containerEl.createEl('p');
    templateEntryInstructionsEl.append(
      createSpan({ text: 'Advanced users may also refer to the ' }),
      createSpan({ text: '{{entry}}', cls: 'text-monospace' }),
      createSpan({
        text:
          ' variable, which contains the full object representation of the ' +
          'reference as used internally by the plugin. See the ',
      }),
      createEl('a', {
        text: 'plugin documentation',
        href: 'http://www.foldl.me/obsidian-citation-plugin/classes/entry.html',
      }),
      createSpan({ text: " for information on this object's structure." }),
    );

    containerEl.createEl('h3', { text: 'Literature notes' });

    new Setting(containerEl)
      .setName('Subfolder name')
      .addText((input) => this.buildValueInput(input, 'literatureNoteFolder'))
      .setDesc(
        'If your citation database is under "vault/folder", and you set subfolder name to "Notes", the literature notes will be saved to "vault/folder/Notes".',
      );

    new Setting(containerEl).setName('Title template').addText((input) =>
      this.buildValueInput(input, 'literatureNoteTitleTemplate', () => {
        // Note titles affect note paths: re-render cached paths.
        this.plugin.registry.refreshNotePaths(true);
      }),
    );

    new Setting(containerEl)
      .setName('Content template')
      .addTextArea((input) =>
        this.buildValueInput(input, 'literatureNoteContentTemplate'),
      );

    new Setting(containerEl)
      .setName('Sync notes to database')
      .setDesc(
        'Write changes made to literature note frontmatter back to the ' +
        'citation database, so the database stays in sync with edits made ' +
        'in the notes. Disable this to keep the database read-only.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncNotesToDatabase)
          .onChange(async (value) => {
            this.plugin.settings.syncNotesToDatabase = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: 'References (CSL)' });
    containerEl.createEl('p', {
      text:
        'Bibliographies are rendered with citeproc-js using the CSL style ' +
        'selected below. Use a fenced `references` code block in a note to ' +
        'render the reference list — leave it empty to auto-scan the note ' +
        'for Pandoc-style citations (`[@citekey]`), or list citekeys one per ' +
        'line.',
    });

    new Setting(containerEl)
      .setName('CSL style')
      .setDesc('Citation style used for bibliography rendering.')
      .addDropdown((component) =>
        this.buildValueInput(component.addOptions(CSL_STYLES), 'cslStyle'),
      );

    new Setting(containerEl)
      .setName('Custom CSL style path')
      .setDesc(
        'Optional path (relative to vault root) to a custom .csl file. ' +
        'Overrides the style dropdown when set.',
      )
      .addText((input) =>
        this.buildValueInput(input, 'customCslStylePath', (value) => {
          this.plugin.settings.cslStyle = 'custom';
          this.plugin.registry.main.addCustomCitationStyle(value);
        }),
      );

    new Setting(containerEl)
      .setName('CSL language')
      .setDesc('Language used for bibliography rendering.')
      .addDropdown((component) =>
        this.buildValueInput(component.addOptions(CSL_LANGS), 'cslLanguage'),
      );
  }

  /**
   * Returns true iff the path exists in the vault; displays error as a side-effect
   */
  async checkCitationExportPath(filePath: string): Promise<boolean> {
    this.citationPathLoadingEl?.addClass('d-none');

    try {
      await this.plugin.app.vault.adapter.read(filePath);
      this.citationPathErrorEl?.addClass('d-none');
    } catch {
      this.citationPathSuccessEl?.addClass('d-none');
      this.citationPathErrorEl?.removeClass('d-none');
      return false;
    }

    return true;
  }

  showCitationExportPathSuccess(): void {
    if (!this.plugin.registry.main) return;

    this.citationPathSuccessEl?.setText(
      `Loaded library with ${this.plugin.registry.main.entries.size} references.`,
    );
    this.citationPathSuccessEl?.removeClass('d-none');
  }
}
