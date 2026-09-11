<script lang="ts">
  import { getMarkdownCitationForCitekey } from '../main';
  import { fileTypes, type EntryMetadata, type FileType } from '../types';
  import { Notice, type App } from 'obsidian';
  import type { CitationDatabase } from '../database';

  import IconArrowDown from '@lucide/svelte/icons/arrow-down';
  import IconArrowUp from '@lucide/svelte/icons/arrow-up';
  import IconClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import IconClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import IconFileUp from '@lucide/svelte/icons/file-up';
  import IconPlus from '@lucide/svelte/icons/plus';
  import IconTrash from '@lucide/svelte/icons/trash';

  let {
    app,
    db,
    getNotePath,
    openAddModal,
    openImportTextModal,
    importRawEntries,
    onChange,
    onRemove,
  }: {
    app: App;
    db: CitationDatabase;
    getNotePath: (id: string) => string;
    openAddModal: () => void;
    openImportTextModal: () => void;
    importRawEntries: (raw: string, format?: FileType) => Promise<void>;
    onChange: () => void;
    onRemove?: (id: string) => void;
  } = $props();

  let containerEl = $state<HTMLDivElement>();
  let entries = $derived(db.entriesRich);
  let fileInputEl = $state<HTMLInputElement>();

  // Only accept files that parse in this database's own format.
  const importAccept = $derived(db.type ? `.${db.type}` : '.bib,.json,.ris');

  async function handleImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so picking the same file again fires another change event.
    input.value = '';
    if (!file) return;

    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const format = fileTypes.find((t) => t === extension);
      await importRawEntries(await file.text(), format);
    } catch (e) {
      console.error('Citation manager: file import failed', e);
      new Notice(
        e instanceof Error ? e.message : 'Failed to import references.',
        5000,
      );
    }
  }

  function handleRemove(id: string) {
    entries.delete(id);
    db.delete(id);
    onChange();
    onRemove?.(id);
  }

  export async function copyCitekey(key: string) {
    const text = getMarkdownCitationForCitekey(key);
    await navigator.clipboard.writeText(text);
  }

  const columns: { key: keyof EntryMetadata; label: string }[] = [
    { key: 'citekey', label: 'Citekey' },
    { key: 'type', label: 'Type' },
    { key: 'year', label: 'Year' },
    { key: 'authorString', label: 'Authors' },
    { key: 'title', label: 'Title' },
    { key: 'DOI', label: 'DOI' },
    { key: 'URL', label: 'URL' },
    { key: 'files', label: 'Files' },
  ];

  let sortKey = $state<keyof EntryMetadata>('citekey');
  let sortDir = $state<'asc' | 'desc'>('asc');

  function toggleSort(key: keyof EntryMetadata) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function compareEntries(a: EntryMetadata, b: EntryMetadata): number {
    const va = a[sortKey];
    const vb = b[sortKey];

    let cmp: number;
    if (Array.isArray(va) || Array.isArray(vb)) {
      cmp =
        (Array.isArray(va) ? va.length : 0) -
        (Array.isArray(vb) ? vb.length : 0);
    } else {
      cmp = String(va ?? '').localeCompare(String(vb ?? ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }

  const sortedEntries = $derived(
    Array.from(entries.values()).sort(compareEntries),
  );

  const linkHover = (node: HTMLSpanElement, link: string) => {
    let currentLink = link;

    const cb = (ev: MouseEvent) => {
      if (!currentLink) return;

      app.workspace.trigger('hover-link', {
        event: ev,
        source: 'bases',
        hoverParent: containerEl,
        targetEl: node,
        linktext: currentLink,
      });
    };

    node.addEventListener('mouseenter', cb);

    return {
      update: (newLink: string) => {
        currentLink = newLink;
      },
      destroy: () => node.removeEventListener('mouseenter', cb),
    };
  };
</script>

<div bind:this={containerEl} class="citation-manager">
  <div class="toolbar">
    <button class="text-icon-button" onclick={() => openAddModal()}>
      <IconPlus class="svg-icon" />
      <span class="text-button-label">Add reference</span>
    </button>
    <button
      title="Import from text"
      aria-label="Import from text"
      class="clickable-icon"
      onclick={() => openImportTextModal()}
    >
      <IconClipboardPaste class="svg-icon" />
    </button>
    <button
      title="Import from file"
      aria-label="Import from file"
      class="clickable-icon"
      onclick={() => fileInputEl?.click()}
    >
      <IconFileUp class="svg-icon" />
    </button>
    <span class="count">{db.entries.size} entries</span>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th
              aria-sort={sortKey === col.key
                ? sortDir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'}
            >
              <button
                class="sort-button{sortKey === col.key ? ' is-sorted' : ''}"
                onclick={() => toggleSort(col.key)}
                title={`Sort by ${col.label.toLowerCase()}`}
              >
                {col.label}
                {#if sortKey === col.key}
                  {#if sortDir === 'asc'}
                    <IconArrowUp class="svg-icon" />
                  {:else}
                    <IconArrowDown class="svg-icon" />
                  {/if}
                {/if}
              </button>
            </th>
          {/each}
          <th class="actions-col"></th>
        </tr>
      </thead>
      <tbody>
        {#each sortedEntries as entry (entry.id)}
          <tr>
            {#each columns as col (col.key)}
              {@const value = entry[col.key]}
              <td>
                <div>
                  {#if col.key === 'citekey'}
                    {@const citekey = (value as string | undefined) ?? entry.id}
                    <span use:linkHover={getNotePath(citekey)}>{citekey}</span>
                    <button
                      title="Copy citation"
                      aria-label="Copy citation"
                      onclick={() => copyCitekey(citekey)}
                      class="clickable-icon"
                    >
                      <IconClipboardCopy class="svg-icon" />
                    </button>
                  {:else if col.key === 'files'}
                    {#if Array.isArray(value) && value.length > 0}
                      <ul>
                        {#each value as file}
                          <li use:linkHover={file.slice(2, -2)}>{file}</li>
                        {/each}
                      </ul>
                    {/if}
                  {:else if col.key === 'DOI' && value}
                    <a href="https://doi.org/{value}">{value}</a>
                  {:else if col.key === 'URL' && value}
                    <a href={value}>{value}</a>
                  {:else if value}
                    {value}
                  {/if}
                </div>
              </td>
            {/each}
            <td class="actions-col">
              <div>
                <!-- <button
                  title="Open literature note"
                  aria-label="Open literature note"
                  onclick={(e) => _onOpenLiteratureNote(entry.id, e.ctrlKey)}
                  class="clickable-icon"
                >
                  <IconNotebookPen class="svg-icon" />
                </button> -->
                <button
                  title="Remove reference"
                  aria-label="Remove reference"
                  onclick={() => handleRemove(entry.id)}
                  class="clickable-icon"
                >
                  <IconTrash class="svg-icon" />
                </button>
              </div>
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan={columns.length + 1} class="empty">
              No references. Click "Add reference" to create one.
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <input
    bind:this={fileInputEl}
    type="file"
    accept={importAccept}
    class="import-file-input"
    onchange={handleImportFile}
  />
</div>

<style>
  .citation-manager {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    padding: var(--size-4-2) var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
  }

  .count {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    margin-left: auto;
  }

  /* Hidden file input: clicked programmatically by the import toolbar
     button. Kept out of the toolbar and visually hidden (not merely
     display:none) so no stray rule can ever make it visible in-flow. */
  .import-file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    display: none;
  }

  .table-wrap {
    flex-grow: 1;
    overflow: auto;
    scrollbar-gutter: stable;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: var(--background-secondary);
  }

  th {
    text-align: left;
    white-space: nowrap;
    padding: 0;
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-muted);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .sort-button {
    --icon-size: 1em;
    display: inline-flex;
    align-items: center;
    gap: var(--size-4-1);
    width: 100%;
    box-sizing: border-box;
    padding: var(--size-4-1) var(--size-4-2);
    font: inherit;
    font-weight: inherit;
    color: inherit;
    background: none;
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
  }

  .sort-button:hover {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
  }

  .sort-button.is-sorted {
    color: var(--text-normal);
  }

  tbody tr:hover {
    background-color: var(--background-modifier-hover);
  }

  td {
    padding: var(--size-4-1) var(--size-4-2);
    font-size: var(--font-ui-small);
    border-bottom: 1px solid var(--background-modifier-border);
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td div {
    --icon-size: 1lh;
    display: flex;
    flex-direction: row;
    align-items: center;
    white-space: nowrap;
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: var(--size-4-6);
    white-space: normal;
  }
</style>
