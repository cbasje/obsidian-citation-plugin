/**
 * Defines an event manager for the citations plugin.
 */

import { Events, type EventRef } from 'obsidian';

export default class CitationEvents extends Events {
  on(name: 'library-load-start', callback: () => any, ctx?: any): EventRef;
  on(name: 'library-load-complete', callback: () => any, ctx?: any): EventRef;
  on(name: 'library-save-start', callback: () => any, ctx?: any): EventRef;
  on(name: 'library-save-complete', callback: () => any, ctx?: any): EventRef;
  /**
   * Fired when the number of inline citation groups in the active editor
   * changes. `count` is the new number of citation groups in the document.
   * Consumers (e.g. a status-bar counter) listen to this to update.
   */
  on(
    name: 'inline-citations-changed',
    callback: (count: number) => any,
    ctx?: any,
  ): EventRef;
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    return super.on(name, callback, ctx);
  }

  trigger(name: 'library-load-start'): void;
  trigger(name: 'library-load-complete'): void;
  trigger(name: 'library-save-start'): void;
  trigger(name: 'library-save-complete'): void;
  trigger(name: 'inline-citations-changed', count: number): void;
  trigger(name: string, ...data: any[]): void {
    super.trigger(name, ...data);
  }
}
