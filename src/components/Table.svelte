<script lang="ts">
  import type { EntryMetadata } from '../types';

  let onChangeFunc: () => void;
  let entries = $state<EntryMetadata[]>([]);

  export function set(input: EntryMetadata[]) {
    entries = input;
  }
  export function get() {
    return $state.snapshot(entries);
  }
  export function onChange(func: () => void) {
    onChangeFunc = func;
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
</script>

<!-- <button>TEST!</button> -->
<table>
  <thead>
    <tr>
      {#each columns as col (col.key)}
        <th>
          <div class="header">
            {col.label}
          </div>
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each entries as entry (entry)}
      <tr>
        {#each columns as col (col.key)}
          {@const value = entry[col.key]}
          <td data-property={col.key}>
            <div class="cell rendered-value" data-property-type="text">
              {#if col.key === 'files'}
                {#if Array.isArray(value) && value.length > 0}
                  <ul>
                    {#each value as file, i}
                      <span>{file}</span><br />
                    {/each}
                  </ul>
                {/if}
              {:else if col.key === 'DOI'}
                <a href="https://doi.org/{value}">{value}</a>
              {:else if col.key === 'URL'}
                <a href={value}>{value}</a>
              {:else if value}
                {value}
              {/if}
            </div>
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  table {
    overflow: auto;
    flex-grow: 1;
    padding: var(--bases-view-padding);
    scrollbar-gutter: stable;
  }

  /*.bases-error {
    padding: 0 var(--size-4-2);
    color: var(--text-warning);
    font-size: var(--font-ui-small);
    text-align: center;
  }
  .bases-header {
    container-type: inline-size;
    container-name: bases-header;
    display: flex;
    align-items: center;
    padding-top: 0;
    padding-bottom: 0;
    padding-inline-start: var(--bases-header-padding-start);
    padding-inline-end: var(--bases-header-padding-end);
    border-width: var(--bases-header-border-width);
    border-color: var(--bases-table-border-color);
    height: var(--bases-header-height);
    min-height: var(--bases-header-height);
    border-style: solid;
  }
  .bases-header .title {
    color: var(--h2-color);
    font-size: var(--h2-size);
  }
  @container (width < 540px) {
    .bases-header .bases-toolbar-item:not(.bases-toolbar-result-count) {
      --bases-toolbar-label-display: none;
      --bases-toolbar-badge-display: none;
    }
  }*/

  thead {
    position: sticky;
    width: 100%;
    height: var(--bases-table-row-height);
    top: 0;
    z-index: var(--layer-cover);
    justify-content: space-between;
    background-color: var(--bases-table-header-background);
    box-shadow: inset 0 calc(var(--bases-table-row-border-width) * -1) 0
      var(--bases-table-border-color);

    th {
      white-space: nowrap;
      align-items: center;

      @media (hover: hover) {
        background-color: var(--bases-table-header-background-hover);
      }

      div.header {
        display: flex;
        width: 100%;
        align-items: center;
        height: var(--bases-table-row-height);
      }
    }
  }

  tbody {
    position: relative;
    width: 100%;
    background: var(--background-primary);
    box-shadow: 0 var(--bases-table-row-border-width) 0
      var(--table-border-color);
  }
  tbody tr:hover {
    background-color: var(--bases-table-row-background-hover);
  }

  /*.bases-table-footer {
    position: sticky !important;
    bottom: 0;
    background-color: var(--bases-table-summary-background);
    width: 100%;
    z-index: var(--layer-sidedock);
  }
  .bases-table-footer .bases-td {
    box-shadow: none;
  }*/

  tr {
    height: var(--bases-table-row-height);
    display: flex;
    flex-direction: row;
    min-width: 100%;
    box-shadow: 0 calc(var(--bases-table-row-border-width) * -1) 0
      var(--table-border-color);
  }

  td {
    box-shadow: calc(var(--bases-table-column-border-width) * -1) 0 0
      var(--table-border-color);
    display: flex;
    height: var(--bases-table-row-height);
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 0 auto;

    &:focus-within {
      background-color: var(--bases-table-cell-background-active);
      border-radius: var(--bases-table-cell-radius-focus);
      box-shadow: var(--bases-table-cell-shadow-focus);
      z-index: 1;
      height: fit-content;
      min-height: var(--bases-table-row-height);
    }

    > div.cell {
      display: flex;
      height: 100%;
      width: 100%;

      /*&[disabled='true'] {
        background-color: var(--bases-table-cell-background-disabled);
      }
      &[data-property-type='checkbox'] {
        justify-content: center;
      }
      & .metadata-input-number,
      &[data-property-type='number'] {
        justify-content: flex-end;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }*/
    }

    .rendered-value {
      --input-border-width: 0;
      padding: var(--metadata-input-padding);
      font-size: var(--bases-table-font-size);
      text-overflow: ellipsis;
      overflow: hidden;

      /*input {
        background: transparent;
        padding: 0;
      }
      input[disabled='true'] {
        pointer-events: none;
        min-height: 0;
      }
      input[disabled='true'][type='date'],
      input[disabled='true'][type='datetime-local'] {
        width: auto;
      }
      img {
        width: auto;
        max-height: 100%;
      }*/
    }
  }
</style>
