<script lang="ts">
  import { getMarkdownCitationForCitekey } from '../main';
  import type { EntryMetadata } from '../types';
  import type { App } from 'obsidian';
  import type { CitationDatabase } from '../database';

  import IconClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import IconPlus from '@lucide/svelte/icons/plus';
  import IconTrash from '@lucide/svelte/icons/trash';

  let {
    app,
    db,
    getNotePath,
    openAddModal,
    onChange,
    onRemove,
  }: {
    app: App;
    db: CitationDatabase;
    getNotePath: (id: string) => string;
    openAddModal: () => void;
    onChange: () => void;
    onRemove?: (id: string) => void;
  } = $props();

  let containerEl = $state<HTMLDivElement>();
  let entries = $derived(db.entriesRich);

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

  const noteHover = (node: HTMLSpanElement, citekey: string) => {
    if (!citekey) return;

    const cb = (ev: MouseEvent) => {
      app.workspace.trigger('hover-link', {
        event: ev,
        source: 'bases',
        hoverParent: containerEl,
        targetEl: node,
        linktext: getNotePath(citekey),
      });
    };

    node.addEventListener('mouseenter', cb);

    return {
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
    <span class="count">{db.entries.size} entries</span>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th>{col.label}</th>
          {/each}
          <th class="actions-col"></th>
        </tr>
      </thead>
      <tbody>
        {#each Array.from(entries.values()) as entry (entry.id)}
          <tr>
            {#each columns as col (col.key)}
              {@const value = entry[col.key]}
              <td>
                <div>
                  {#if col.key === 'citekey'}
                    {@const citekey = value ?? entry.id}
                    <span use:noteHover={citekey}>{citekey}</span>
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
                          <li>{file}</li>
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
    padding: var(--size-4-1) var(--size-4-2);
    font-size: var(--font-ui-small);
    font-weight: var(--font-medium);
    color: var(--text-muted);
    border-bottom: 1px solid var(--background-modifier-border);
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
