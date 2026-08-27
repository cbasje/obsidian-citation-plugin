<script lang="ts">
  import {
    type DatabaseType,
    type EntryData,
    type EntryDataBibLaTeX,
    type EntryDataCSL,
    Library,
  } from '../types';

  let {
    dbType,
    basePath,
  }: { dbType: DatabaseType; basePath: string | undefined } = $props();

  let onChangeFunc: () => void = () => {};
  let entries = $state<EntryData[]>([]);

  let metadata = $derived.by(() => {
    if (entries.length === 0) return [];
    const lib = new Library(entries, dbType, basePath);
    return Object.values(lib.entries);
  });

  export function set(input: EntryData[]) {
    entries = input;
  }
  export function get() {
    return $state.snapshot(entries);
  }
  export function onChange(func: () => void) {
    onChangeFunc = func;
  }

  function generateId(): string {
    const existing = new Set(entries.map((e) => (e as EntryDataCSL).id));
    const base = 'untitled';
    let n = 1;
    let id = base;
    while (existing.has(id)) {
      id = `${base}-${n++}`;
    }
    return id;
  }

  function createEmptyEntry(id: string): EntryData {
    if (dbType === 'biblatex') {
      const csl: EntryDataCSL = { id, type: 'article-journal' };
      return {
        ...csl,
        _biblatex: {
          label: id,
          type: 'article',
          properties: {},
        },
      } as EntryDataBibLaTeX;
    }
    return { id, type: 'article-journal' };
  }

  function handleAdd() {
    const id = generateId();
    entries.push(createEmptyEntry(id));
    onChangeFunc();
  }

  function handleRemove(id: string) {
    entries = entries.filter((e) => (e as EntryDataCSL).id !== id);
    onChangeFunc();
  }

  const columns: { key: keyof (typeof metadata)[number]; label: string }[] = [
    { key: 'citekey', label: 'Citekey' },
    { key: 'type', label: 'Type' },
    { key: 'year', label: 'Year' },
    { key: 'authorString', label: 'Authors' },
    { key: 'title', label: 'Title' },
    { key: 'DOI', label: 'DOI' },
    { key: 'URL', label: 'URL' },
    { key: 'files', label: 'Files' },
  ];
</script>

<div class="citation-manager">
  <div class="toolbar">
    <button class="add-button" onclick={handleAdd}>
      <span class="icon">+</span> Add reference
    </button>
    <span class="count">{entries.length} entries</span>
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
        {#each metadata as entry (entry.id)}
          <tr>
            {#each columns as col (col.key)}
              {@const value = entry[col.key]}
              <td>
                {#if col.key === 'files'}
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
              </td>
            {/each}
            <td class="actions-col">
              <button
                class="remove-button"
                title="Remove reference"
                aria-label="Remove reference"
                onclick={() => handleRemove(entry.id)}>×</button
              >
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

  .add-button {
    display: flex;
    align-items: center;
    gap: var(--size-4-1);
  }
  .add-button .icon {
    font-size: 1.1em;
    line-height: 1;
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

  td ul {
    margin: 0;
    padding-left: var(--size-4-3);
    list-style: square;
  }
  td li {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  td a {
    color: var(--text-accent);
    text-decoration: none;
  }
  td a:hover {
    text-decoration: underline;
  }

  .actions-col {
    width: 2.2em;
    text-align: center;
    white-space: nowrap;
  }

  .remove-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6em;
    height: 1.6em;
    padding: 0;
    border: none;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--text-muted);
    font-size: 1.1em;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.1s,
      color 0.1s,
      background 0.1s;
  }
  tbody tr:hover .remove-button {
    opacity: 1;
  }
  .remove-button:hover {
    color: var(--text-error);
    background-color: var(--background-modifier-error-hover);
  }

  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: var(--size-4-6);
    white-space: normal;
  }
</style>
