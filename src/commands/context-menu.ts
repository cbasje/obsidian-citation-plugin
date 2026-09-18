import { TFolder } from 'obsidian';
import type CitationPlugin from '../main';
import type { CitationDatabase } from '../database';
import { AddReferenceModal, ImportTextModal } from '../modals';
import { CIT_ICON } from '../types';
import {
  createAllLiteratureNotes,
  fetchAndAddEntry,
  importRawEntries,
} from './reference-actions';

/**
 * Add citation actions to the file-explorer context menu:
 *
 * - Any folder gets "New empty citation database".
 * - A folder whose name matches the configured literature note folder
 *   gets "Add reference", "Import references" and "Create literature
 *   notes for all references", targeting the database file that lives in
 *   the folder's parent.
 */
export function registerFileMenu(plugin: CitationPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file, source) => {
      if (source === 'link-context-menu') return;
      if (!(file instanceof TFolder)) return;

      menu.addItem((item) => {
        item
          .setSection('action-primary')
          .setTitle('New empty citation database')
          .setIcon(CIT_ICON)
          .onClick(() => plugin.newDatabaseFile(file));
      });

      const db = databaseForLiteratureNoteFolder(plugin, file);
      if (!db) return;

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setSection('action-primary')
          .setTitle('Add reference')
          .setIcon(CIT_ICON)
          .onClick(() =>
            new AddReferenceModal(plugin.app, (idType, id) =>
              fetchAndAddEntry(db, idType, id),
            ).open(),
          );
      });

      menu.addItem((item) => {
        item
          .setSection('action-primary')
          .setTitle('Import references from file')
          .setIcon(CIT_ICON)
          .onClick(() =>
            new ImportTextModal(plugin.app, db.type, (raw, format) =>
              importRawEntries(db, raw, format),
            ).open(),
          );
      });

      menu.addItem((item) => {
        item
          .setSection('action-primary')
          .setTitle('Create literature notes for all references')
          .setIcon(CIT_ICON)
          .onClick(() =>
            createAllLiteratureNotes(plugin, db).catch(console.error),
          );
      });
    }),
  );
}

/**
 * The database targeted by a literature notes folder: only folders whose
 * name matches the configured literature note folder qualify, and the
 * database file must live in the folder's parent.
 */
function databaseForLiteratureNoteFolder(
  plugin: CitationPlugin,
  folder: TFolder,
): CitationDatabase | undefined {
  if (folder.name !== plugin.settings.literatureNoteFolder) return undefined;

  const dbFile = plugin.getDatabaseChild(folder.parent);
  if (!dbFile) return undefined;

  return plugin.registry.hold(dbFile.path);
}
