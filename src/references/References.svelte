<script lang="ts">
  import type { CitationDatabase } from '../database';

  let {
    db,
  }: {
    db: CitationDatabase | undefined;
  } = $props();

  let citekeys = $state<string[]>([]);
  export function setCitekeys(input: string[]) {
    citekeys = input;
  }

  const valid = $derived.by(() => {
    if (!db) return [];
    const ids = Array.from(db.entries.keys());
    return ids.filter((k) => citekeys.includes(k));
  });
  const bib = $derived(db ? db.renderBibliography(valid) : []);
</script>

{#if !db || db.entries.size === 0}
  <p class="csl-placeholder">Citation library is not loaded.</p>
{:else if valid.length === 0}
  <p class="csl-placeholder">No citations found.</p>
{:else if bib.length === 0}
  <p class="csl-placeholder">No bibliography entries could be rendered.</p>
{:else}
  <div class="csl-bibliography">
    {@html bib.join('')}
  </div>
{/if}

<style>
  /** CSL bibliography rendering (citeproc-js output) **/

  .csl-bibliography :global {
    line-height: 1.5;

    .csl-entry {
      margin-bottom: 0.5em;
      text-indent: -2em;
      padding-left: 2em;
      hanging-punctuation: none;
    }

    /* Numbered styles (e.g. IEEE) use a left margin + right inline layout */
    .csl-left-margin {
      display: inline-block;
      min-width: 2em;
      text-align: right;
    }

    .csl-right-inline {
      display: inline;
      margin-left: 0.5em;
    }

    .csl-block {
      display: block;
    }

    .csl-indent {
      margin-left: 2em;
    }
  }

  .csl-placeholder {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
