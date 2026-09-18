import { Notice } from 'obsidian';
import type CitationPlugin from '../main';
import type { CitationDatabase } from '../database';
import { deserializeEntries } from '../database/serializer';
import { fetchEntryById, generateCiteKey, type IdType } from '../fetcher';
import {
  type EntryDataBibLaTeX,
  type EntryDataCSL,
  type FileType,
  getEntryMetadata,
} from '../types';

/**
 * Ensure the database is loaded from disk before mutating it, so a failed
 * or partial load can never be saved back over the database file.
 *
 * Returns true when the database is ready to use; shows a Notice and
 * returns false otherwise.
 */
async function ensureLoaded(db: CitationDatabase): Promise<boolean> {
  if (db.isLoading) {
    new Notice('The citation database is still loading. Please try again.');
    return false;
  }
  if (db.entries.size > 0) return true;

  try {
    await db.load();
    return true;
  } catch (e) {
    new Notice(
      e instanceof Error ? e.message : 'Unable to load the citation database.',
    );
    return false;
  }
}

/** Create the literature note for `citekey`, if it does not exist yet. */
async function createLiteratureNote(
  db: CitationDatabase,
  citekey: string,
): Promise<void> {
  try {
    await db.getOrCreateLiteratureNoteFile(citekey);
  } catch (e) {
    // getOrCreateLiteratureNoteFile already shows a Notice on failure;
    // log and continue so one bad entry does not abort the batch.
    console.error('Citation manager: failed to create literature note', e);
  }
}

/**
 * Fetch reference metadata for the given identifier, add the entries to
 * the database, save it, and create literature notes for the new entries.
 */
export async function fetchAndAddEntry(
  db: CitationDatabase,
  idType: IdType,
  id: string,
): Promise<void> {
  const dbType = db.type;
  if (!dbType) {
    new Notice('Cannot add: unsupported library file type.');
    return;
  }
  if (!(await ensureLoaded(db))) return;

  const fetched = await fetchEntryById(idType, id);
  if (fetched.length === 0) return;

  const added: string[] = [];
  for (const entry of fetched) {
    entry.id = generateCiteKey(entry, db.ids);
    db.add(getEntryMetadata(entry.id, entry, dbType, db.dir, db.vaultPath));
    added.push(entry.id);
  }

  await db.save();

  for (const id of added) {
    await createLiteratureNote(db, id);
  }
}

/**
 * Parse raw text in the given format (BibLaTeX, CSL-JSON, or RIS,
 * defaulting to the database's own format) and merge the entries into the
 * database. Entries keep the citekey assigned by their source when it is
 * free; on collision a fresh unique key is minted (and the raw BibLaTeX
 * label is updated along with it, so the library still round-trips when
 * saved back to .bib). Afterwards the database is saved and literature
 * notes are created for the newly added entries.
 */
export async function importRawEntries(
  db: CitationDatabase,
  raw: string,
  format?: FileType,
): Promise<void> {
  const importType = format ?? db.type;
  if (!importType) {
    new Notice('Cannot import: unsupported library file type.');
    return;
  }
  if (!(await ensureLoaded(db))) return;

  const parsed = deserializeEntries(raw, importType);
  if (parsed.length === 0) {
    new Notice('No entries found in the provided data.');
    return;
  }

  const added: string[] = [];
  for (const entry of parsed) {
    let id = entry.id;
    if (!id || db.entries.has(id)) {
      id = generateCiteKey(entry, db.ids);
      entry.id = id;
      const rawLabel = (entry as EntryDataBibLaTeX)._biblatex;
      if (rawLabel) rawLabel.label = id;
    }
    db.add(
      getEntryMetadata(
        id,
        entry as EntryDataCSL,
        importType,
        db.dir,
        db.vaultPath,
      ),
    );
    added.push(id);
  }

  await db.save();
  new Notice(
    `Imported ${parsed.length} ${parsed.length === 1 ? 'entry' : 'entries'}.`,
  );

  for (const id of added) {
    await createLiteratureNote(db, id);
  }
}

/**
 * Create a literature note for every entry in the database. Notes that
 * already exist are left untouched (never overwritten).
 */
export async function createAllLiteratureNotes(
  plugin: CitationPlugin,
  db: CitationDatabase,
): Promise<void> {
  if (!(await ensureLoaded(db))) return;

  let created = 0;
  let existing = 0;

  for (const id of db.ids) {
    const notePath = await db.getPathForCitekey(id);
    if (plugin.app.vault.getAbstractFileByPath(notePath)) {
      existing++;
      continue;
    }
    try {
      await db.getOrCreateLiteratureNoteFile(id);
      created++;
    } catch (e) {
      console.error('Citation manager: failed to create literature note', e);
    }
  }

  new Notice(
    `Created ${created} literature ${created === 1 ? 'note' : 'notes'}` +
    (existing > 0 ? `; ${existing} already existed` : '') +
    '.',
  );
}
