import { type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type CitationPlugin from '../main';
import { inlineStateField } from './inlineState';
import type { CitationRange } from './parse';

/**
 * Per-view record of the last citation count emitted to the plugin's
 * event bus. Used so the first update of a freshly created editor (e.g.
 * on leaf switch) pushes its count even when it equals the previously
 * active editor's count.
 */
const lastEmitted = new WeakMap<EditorView, number | undefined>();

/**
 * An `updateListener` extension that emits an `inline-citations-changed`
 * event through the plugin's event bus whenever the number of citation
 * groups in an editor changes (including the first update of a new
 * editor). This is the hook a status-bar counter (or any other consumer)
 * listens to.
 *
 * This intentionally does NOT render anything into the editor — the
 * source `[@citekey]` markers are left untouched while writing. Reading
 * view renders formatted citations via the markdown post-processor.
 */
function buildCountEmitter(plugin: CitationPlugin): Extension {
  return EditorView.updateListener.of((update) => {
    const ranges: CitationRange[] =
      update.state.field(inlineStateField, false) ?? [];
    const count = ranges.length;
    const prev = lastEmitted.get(update.view);
    if (prev !== count) {
      lastEmitted.set(update.view, count);
      plugin.events.trigger('inline-citations-changed', count);
    }
  });
}

/**
 * Build the editor extension that tracks inline `[@citekey]` markers in a
 * shared `StateField` (consumed by the status-bar counter) without
 * altering the editor view.
 */
export function buildInlineCitationExtension(
  plugin: CitationPlugin,
): Extension {
  return Prec.lowest([inlineStateField, buildCountEmitter(plugin)]);
}
