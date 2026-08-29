import type { CitationItem } from 'citeproc';

/**
 * Matches a full Pandoc-style bracketed citation group: `[@citekey]`,
 * `[-@citekey]`, `[@smith2020; @jones2019, p. 5]`. Capture group 1 is the
 * text inside the brackets (without the surrounding `[]`).
 */
const CITATION_GROUP_PATTERN = /\[(-?@[^\]]+)\]/g;

/**
 * Matches bare `@citekey` / `-@citekey` tokens used when auto-scanning a
 * note for the reference list. Group 1 is the citekey from a bracketed
 * form, group 2 is the citekey from a bare form.
 */
const CITEKEY_PATTERN = /\[-?@([^\]\s]+)\]|@([A-Za-z0-9_:-]+)/g;

/**
 * A citation group located within a document's text. `from`/`to` are
 * character offsets into the source text, `raw` is the full matched
 * substring (including brackets) and `items` are the parsed citeproc
 * citation items in document order within the group.
 */
export interface CitationRange {
  from: number;
  to: number;
  raw: string;
  items: CitationItem[];
}

/**
 * Extract Pandoc-style citekeys (`[@citekey]`, `@citekey`, `[-@citekey]`)
 * from a block of text, preserving order of first appearance. Used by the
 * `references` code block processor to auto-scan a note.
 */
export function extractCitekeys(text: string): string[] {
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  CITEKEY_PATTERN.lastIndex = 0;
  while ((match = CITEKEY_PATTERN.exec(text)) !== null) {
    const key = match[1] || match[2];
    if (key) seen.add(key);
  }
  return Array.from(seen);
}

/**
 * Parse the contents of a bracketed Pandoc citation (the text inside
 * `[@...]`) into an array of citeproc `CitationItem`s.
 *
 * Examples:
 *   "@smith2020"                     -> [{id:"smith2020"}]
 *   "-@smith2020"                    -> [{id:"smith2020","suppress-author":true}]
 *   "@smith2020, p. 5"               -> [{id:"smith2020",locator:"p. 5"}]
 *   "@smith2020; @jones2019"         -> [{id:"smith2020"},{id:"jones2019"}]
 *
 * Returns `null` if the content does not parse as a valid citation group.
 */
export function parseCitationGroup(content: string): CitationItem[] | null {
  const parts = content.split(';').map((s) => s.trim());
  const items: CitationItem[] = [];

  for (const part of parts) {
    const m = part.match(/^(-?)@([^\s,]+)(?:\s*,\s*(.+))?$/);
    if (!m) return null;

    const [, suppress, citekey, locator] = m;
    const item: CitationItem = { id: citekey! };
    if (suppress) item['suppress-author'] = true;
    if (locator) item.locator = locator.trim();
    items.push(item);
  }

  return items.length > 0 ? items : null;
}

/**
 * Scan a block of text and return all bracketed Pandoc citation groups
 * (`[@...]`) in document order, with their character offsets and parsed
 * citeproc items. Citations whose contents fail to parse are skipped.
 */
export function scanCitations(text: string): CitationRange[] {
  const ranges: CitationRange[] = [];
  // Use a fresh regex instance to avoid shared `lastIndex` state.
  const pattern = new RegExp(CITATION_GROUP_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const items = parseCitationGroup(match[1]!);
    if (items && items.length > 0) {
      ranges.push({
        from: match.index,
        to: match.index + match[0].length,
        raw: match[0],
        items,
      });
    }
  }
  return ranges;
}
