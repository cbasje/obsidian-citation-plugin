import { normalizePath, TAbstractFile, TFile } from 'obsidian';
import { CitationDatabase } from './index';
import { fileTypes } from '../types';
import type CitationPlugin from '../main';

/**
 * Registry of all citation database files discovered in the vault and
 * the `CitationDatabase` instances loaded from them.
 *
 * Instances are refcounted: each consumer (the plugin's main db, an
 * editor view) calls `acquire` to get-or-create and `release` when
 * done. When the refcount drops to zero the instance is evicted from
 * the cache (freeing memory), but the path remains in `paths` so the
 * settings dropdown and future `acquire` calls still work.
 */
export class DatabaseRegistry {
  /** All discovered candidate paths (for settings dropdown, etc.). */
  readonly paths = new Set<string>();

  /** Loaded instances, keyed by normalized vault path. */
  private dbs = new Map<string, CitationDatabase>();

  /** Refcount per path — evict instance at 0. */
  private refs = new Map<string, number>();

  /** The path that is permanently held as the "main" database. */
  private mainPath: string | undefined;

  constructor(private plugin: CitationPlugin) { }

  /**
   * Scan the vault for files with a supported extension and populate
   * `paths`. Called once on startup; kept in sync afterwards via file
   * event handlers (`add`, `remove`, `rename`).
   */
  discover(): void {
    const files = this.plugin.app.vault.getFiles();
    for (const f of files) {
      if (DatabaseRegistry.isPotentialDatabase(f)) {
        console.debug(`Citation manager: found ${f.path}`);
        this.paths.add(f.path);
      }
    }
  }

  /**
   * Get-or-create the `CitationDatabase` for `path` and increment its
   * refcount. The caller must pair this with a `release` call.
   */
  acquire(path: string): CitationDatabase {
    const key = normalizePath(path);

    let db = this.dbs.get(key);
    if (!db) {
      const file = this.plugin.app.vault.getFileByPath(key);
      if (file) {
        db = new CitationDatabase(file, this.plugin);
      } else {
        db = new CitationDatabase(key, this.plugin);
      }
      this.dbs.set(key, db);
    }

    this.refs.set(key, (this.refs.get(key) ?? 0) + 1);
    return db;
  }

  /**
   * Decrement the refcount for `path`. When it reaches zero the
   * instance is evicted — *unless* it is the main path, which is held
   * permanently until `setMain` clears it.
   *
   * The path entry in `paths` is never removed by `release`.
   */
  release(path: string): void {
    const key = normalizePath(path);
    const count = (this.refs.get(key) ?? 0) - 1;
    if (count <= 0) {
      this.refs.delete(key);
      if (key !== this.mainPath) {
        const db = this.dbs.get(key);
        if (db) {
          db.clear();
          this.dbs.delete(key);
        }
      }
    } else {
      this.refs.set(key, count);
    }
  }

  /**
   * Peek at the instance for `path` without changing the refcount.
   */
  peek(path: string): CitationDatabase | undefined {
    return this.dbs.get(normalizePath(path));
  }

  /**
   * The main database instance (bound to `settings.citationExportPath`),
   * or `undefined` when no main path is set / the file is missing.
   */
  get main(): CitationDatabase | undefined {
    if (!this.mainPath) return undefined;
    return this.dbs.get(this.mainPath);
  }

  /**
   * The main database path, or `undefined`.
   */
  get mainDbPath(): string | undefined {
    return this.mainPath;
  }

  /**
   * Set the main database path. If changing from a previous path, the
   * old main reference is released (instance may be evicted). The new
   * path is acquired and held permanently.
   *
   * Pass `undefined` to clear the main path.
   */
  setMain(path: string | undefined): void {
    if (this.mainPath) {
      // Temporarily clear mainPath so release() can evict the old instance.
      const old = this.mainPath;
      this.mainPath = undefined;
      this.release(old);
    }

    if (path) {
      const key = normalizePath(path);
      this.mainPath = key;
      // Acquire a permanent reference (will create the instance if needed).
      this.acquire(key);
    } else {
      this.mainPath = undefined;
    }
  }

  /**
   * Remove a path entirely (file deleted). Drops both the instance and
   * the path entry from `paths`. Also clears the main path if it matches.
   */
  remove(path: string): void {
    const key = normalizePath(path);
    this.paths.delete(key);

    if (this.mainPath === key) {
      this.mainPath = undefined;
      this.refs.delete(key);
    } else {
      this.refs.delete(key);
    }

    const db = this.dbs.get(key);
    if (db) {
      db.clear();
      this.dbs.delete(key);
    }
  }

  /**
   * Remap a path after a file rename. The instance (if any) is
   * preserved and re-keyed; its `path`/`file` are updated in-place.
   */
  rename(oldPath: string, newPath: string): void {
    const oldKey = normalizePath(oldPath);
    const newKey = normalizePath(newPath);

    if (oldKey === newKey) return;

    // Update paths set.
    this.paths.delete(oldKey);
    this.paths.add(newKey);

    // Remap instance.
    const db = this.dbs.get(oldKey);
    if (db) {
      this.dbs.delete(oldKey);
      this.dbs.set(newKey, db);
      const file = this.plugin.app.vault.getFileByPath(newKey);
      if (file) {
        db.file = file;
        db.path = file.path;
      } else {
        db.path = newKey;
      }
    }

    // Remap refcount.
    const count = this.refs.get(oldKey);
    if (count !== undefined) {
      this.refs.delete(oldKey);
      this.refs.set(newKey, count);
    }

    // Update main path.
    if (this.mainPath === oldKey) {
      this.mainPath = newKey;
    }
  }

  /**
   * Track a newly created file as a candidate path if it has a
   * supported extension.
   */
  add(file: TFile): void {
    if (DatabaseRegistry.isPotentialDatabase(file)) {
      this.paths.add(file.path);
    }
  }

  static isPotentialDatabase(file: TAbstractFile): file is TFile {
    return (
      file instanceof TFile &&
      // @ts-expect-error This is fine
      fileTypes.includes(file.extension.toLowerCase())
    );
  }
}
