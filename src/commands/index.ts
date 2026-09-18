import { Notice } from 'obsidian';
import type CitationPlugin from '../main';
import type { CitationDatabase } from '../database';
import { AddReferenceModal, ImportTextModal, InsertCitationModal, OpenNoteModal } from '../modals';
import {
  createAllLiteratureNotes,
  fetchAndAddEntry,
  importRawEntries,
} from './reference-actions';
import { ReferencesBlockView } from '../references/references';

/** The loaded main database, or a Notice + undefined when none is set. */
function mainDatabase(plugin: CitationPlugin): CitationDatabase | undefined {
  const db = plugin.registry.main;
  if (!db) {
    new Notice(
      'No citation database configured. Select one in the Citations plugin settings.',
    );
    return undefined;
  }
  return db;
}

export function registerCommands(plugin: CitationPlugin): void {
  plugin.addCommand({
    id: 'add-reference',
    name: 'Add reference',
    callback: () => {
      const db = mainDatabase(plugin);
      if (!db) return;
      new AddReferenceModal(plugin.app, (idType, id) =>
        fetchAndAddEntry(db, idType, id),
      ).open();
    },
  });

  plugin.addCommand({
    id: 'import-references',
    name: 'Import references from file',
    callback: () => {
      const db = mainDatabase(plugin);
      if (!db) return;
      new ImportTextModal(plugin.app, db.type, (raw, format) =>
        importRawEntries(db, raw, format),
      ).open();
    },
  });

  plugin.addCommand({
    id: 'create-literature-notes',
    name: 'Create literature notes for all references',
    callback: () => {
      const db = mainDatabase(plugin);
      if (!db) return;
      createAllLiteratureNotes(plugin, db).catch(console.error);
    },
  });

  plugin.addCommand({
    id: 'open-literature-note',
    name: 'Open literature note',
    hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'o' }],
    callback: () => {
      const modal = new OpenNoteModal(plugin.app, plugin);
      modal.open();
    },
  });

  plugin.addCommand({
    id: 'update-bib-data',
    name: 'Refresh citation database',
    hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'r' }],
    callback: () => {
      plugin.loadDatabase();
    },
  });

  plugin.addCommand({
    id: 'insert-markdown-citation',
    name: 'Insert citation',
    callback: () => {
      const modal = new InsertCitationModal(plugin.app, plugin);
      modal.open();
    },
  });

  plugin.addCommand({
    id: 'insert-references-block',
    name: 'Insert references block',
    callback: () => {
      ReferencesBlockView.insert(plugin.editor);
    },
  });
}
