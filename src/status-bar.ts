import { MarkdownView } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type CitationPlugin from './main';
import { inlineStateField } from './citations/inlineState';

/**
 * Status-bar counter showing the number of inline citation groups in the
 * active editor.
 *
 * Two paths keep it in sync:
 *  - live edits: the `inline-citations-changed` event emitted by the
 *    editor extension's `updateListener`;
 *  - initial load / leaf switch: a direct read of the active editor's
 *    `inlineStateField`, since the `updateListener` only fires on
 *    subsequent transactions, not on view creation.
 */
export class StatusBarCounter {
  private item: HTMLElement;
  private count = -1;

  constructor(private plugin: CitationPlugin) {
    this.item = plugin.addStatusBarItem();
    this.item.addClass('citation-status-counter');
    this.render();
  }

  register(): void {
    this.plugin.registerEvent(
      this.plugin.events.on(
        'inline-citations-changed',
        (count: number) => this.setCount(count),
        this,
      ),
    );
    // Refresh on leaf switch and when a file opens (covers initial load
    // + switching notes), since the editor's updateListener only fires
    // on later transactions, not on view creation.
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('active-leaf-change', () => {
        setTimeout(() => this.refresh(), 0);
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('file-open', () => {
        setTimeout(() => this.refresh(), 0);
      }),
    );
    this.refresh();
  }

  /**
   * Read the citation count directly from the active editor's CodeMirror
   * state. Hides the counter entirely when the active view is not a
   * Markdown editor.
   */
  private refresh(): void {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.item.style.display = 'none';
      this.count = -1;
      return;
    }
    this.item.style.display = '';
    const cm = (view.editor as unknown as { cm?: EditorView | undefined }).cm;
    const ranges = cm?.state.field(inlineStateField, false);
    this.setCount(ranges ? ranges.length : 0);
  }

  private setCount(count: number): void {
    if (count === this.count) return;
    this.count = count;
    this.render();
  }

  private render(): void {
    const span = this.item;
    span.empty();
    // span.createEl('span', {
    //   cls: 'citation-status-counter__icon',
    //   text: '\u{1F4D6}',
    // });
    span.createEl('span', {
      cls: 'citation-status-counter__count',
      text: `${Math.max(this.count, 0)}`,
    });
    span.createEl('span', {
      cls: 'citation-status-counter__text',
      text: 'citations',
    });
    span.setAttr('aria-label', `${Math.max(this.count, 0)} inline citations`);
  }
}
