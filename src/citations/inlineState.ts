import { StateField } from '@codemirror/state';
import type { CitationRange } from './parse';
import { scanCitations } from './parse';

/**
 * A CodeMirror `StateField` holding the parsed bracketed Pandoc citation
 * groups for the current document, in document order.
 *
 * This is the single source of truth consumed by:
 *  - the decoration field (`buildInlineDecorationField`) for Live
 *    Preview rendering, and
 *  - the status-bar counter (via the `inline-citations-changed` event,
 *    emitted when the citation count changes).
 *
 * It recomputes on every document change. Style or library reloads don't
 * change the source text, so the ranges stay valid; the decoration field
 * handles re-rendering the citeproc output in that case.
 */
export const inlineStateField: StateField<CitationRange[]> = StateField.define<
  CitationRange[]
>({
  create(state) {
    return scanCitations(state.doc.toString());
  },
  update(value, tr) {
    if (tr.docChanged) {
      return scanCitations(tr.state.doc.toString());
    }
    return value;
  },
});
