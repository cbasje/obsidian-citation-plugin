import { Cite, plugins, type CSL } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import type {
  DatabaseType,
  EntryData,
  EntryDataBibLaTeX,
  EntryDataCSL,
} from './types';

/**
 * Parse raw database text into reference entries.
 *
 * Throws an `Error` with a human-readable message when the input cannot be
 * parsed or fails validation (CSL-JSON shape checks, BibLaTeX parse
 * failures, or an empty result). The thrown `Error.message` is suitable
 * for direct display to the user.
 *
 * For BibLaTeX, Citation.js parses the input into CSL-JSON (for citeproc)
 * and the raw BibLaTeX properties are attached under `_biblatex` so that
 * `serializeEntries` can round-trip BibLaTeX-specific fields (`file`,
 * `eprint`, `eprinttype`, raw LaTeX `note`).
 */
export function deserializeEntries(
  databaseRaw: string,
  databaseType: DatabaseType,
): EntryData[] {
  if (databaseType === 'csl-json') {
    const parsed = parseCslJson(databaseRaw);
    validateCslJsonEntries(parsed);
    return parsed;
  }

  if (databaseType === 'biblatex') {
    let cslEntries: CSL[];
    try {
      const cite = new Cite(databaseRaw);
      cslEntries = cite.data;
    } catch (err) {
      console.error(
        'Citation plugin: fatal error loading BibLaTeX database:',
        err,
      );
      // @ts-expect-error — Node Error.cause not in lib target
      throw new Error('This file could not be parsed as BibLaTeX.', {
        cause: err,
      });
    }

    if (cslEntries.length === 0) return [];

    // Also parse raw entries to preserve BibLaTeX-specific fields.
    let rawEntries: {
      label: string;
      type: string;
      properties: Record<string, string>;
    }[] = [];
    try {
      rawEntries = plugins.input.chainLink(databaseRaw);
    } catch {
      // chainLink may fail on malformed input; CSL parse above is the
      // authoritative one, so continue with empty raw entries.
    }
    const rawMap = new Map(rawEntries.map((e) => [e.label, e]));

    return cslEntries.map((csl) => {
      // Strip Citation.js provenance graph to save memory.
      const { _graph, ...cleanCsl } = csl as Record<string, unknown>;
      const raw = rawMap.get((cleanCsl as EntryDataCSL).id);
      return { ...cleanCsl, _biblatex: raw } as EntryDataBibLaTeX;
    });
  }

  throw new Error(`Unsupported database type: ${databaseType}.`);
}

/**
 * Parse a CSL-JSON string into an array, throwing a user-facing error when
 * the content is not valid JSON or not a JSON array.
 */
function parseCslJson(raw: string): EntryDataCSL[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('This file is not valid CSL-JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('This file is not valid CSL-JSON: expected a JSON array.');
  }
  return parsed as EntryDataCSL[];
}

/**
 * Validate that a parsed CSL-JSON array is non-empty and that every entry
 * has the required `id` and `type` string fields. Throws a user-facing
 * error otherwise.
 */
function validateCslJsonEntries(entries: EntryDataCSL[]): void {
  if (entries.length === 0) {
    throw new Error('This file is not valid CSL-JSON: the array is empty.');
  }
  for (const entry of entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== 'string' ||
      typeof (entry as { type?: unknown }).type !== 'string'
    ) {
      throw new Error(
        'This file is not valid CSL-JSON: every entry must have ' +
          'string "id" and "type" fields.',
      );
    }
  }
}

/**
 * Serialize parsed reference entries back into the textual format of the
 * given database type, such that parsing the result with
 * `deserializeEntries` yields an equivalent set of entries.
 *
 * For CSL-JSON the output is a pretty-printed JSON array.
 * For BibLaTeX each entry is reconstructed from the raw `_biblatex`
 * properties (preserved by `deserializeEntries` via `chainLink`), which
 * keeps BibLaTeX-specific fields (`file`, `eprint`, `eprinttype`, raw
 * `note`, ...) intact. Entries lacking `_biblatex` fall back to a minimal
 * CSL-derived property set so no data is silently dropped.
 */
export function serializeEntries(
  entries: EntryData[],
  databaseType: DatabaseType,
): string {
  if (databaseType === 'csl-json') {
    return serializeCslJson(entries as EntryDataCSL[]);
  }
  return serializeBibLaTeX(entries as EntryDataBibLaTeX[]);
}

function serializeCslJson(entries: EntryDataCSL[]): string {
  const clean = entries.map((entry) => {
    const { _biblatex, _graph, ...rest } = entry as EntryDataCSL & {
      _biblatex?: unknown;
      _graph?: unknown;
    };
    return rest;
  });
  return `${JSON.stringify(clean, null, 2)}\n`;
}

function serializeBibLaTeX(entries: EntryDataBibLaTeX[]): string {
  const blocks: string[] = [];

  for (const entry of entries) {
    const raw = entry._biblatex;
    const type = raw?.type ?? cslTypeToBibLatexType(entry.type);
    const label = raw?.label ?? entry.id;

    let properties: Record<string, string>;
    if (raw) {
      properties = { ...raw.properties };
    } else {
      properties = cslToBibLatexProperties(entry);
    }

    blocks.push(formatBibLatexEntry(type, label, properties));
  }

  return `${blocks.join('\n\n')}\n`;
}

function formatBibLatexEntry(
  type: string,
  label: string,
  properties: Record<string, string>,
): string {
  const lines: string[] = [`@${type}{${label},`];
  for (const [field, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    lines.push(`  ${field} = {${value}},`);
  }
  // Replace trailing comma on the last field with a closing brace.
  const last = lines.length - 1;
  if (lines[last].endsWith(',')) {
    lines[last] = `${lines[last].slice(0, -1)}`;
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * Minimal CSL → BibLaTeX field mapping, used only as a fallback when an
 * entry has no `_biblatex` raw properties (e.g. entries not present in the
 * original file but added programmatically).
 */
function cslToBibLatexProperties(entry: EntryDataCSL): Record<string, string> {
  const props: Record<string, string> = {};

  if (entry.title) props.title = entry.title;
  if (entry.author) props.author = formatAuthor(entry.author);
  if (entry.issued?.['date-parts']?.[0]) {
    const parts = entry.issued['date-parts'][0];
    if (parts.length === 1) props.year = String(parts[0]);
    else if (parts.length >= 3) props.date = parts.join('-');
    else props.date = parts.join('-');
  }
  if (entry['container-title']) props.journaltitle = entry['container-title'];
  if (entry.DOI) props.doi = entry.DOI;
  if (entry.URL) props.url = entry.URL;
  if (entry.volume) props.volume = entry.volume;
  if (entry.issue) props.number = entry.issue;
  if (entry.page) props.pages = entry.page;
  if (entry.publisher) props.publisher = entry.publisher;
  if (entry['publisher-place']) props.location = entry['publisher-place'];
  if (entry.abstract) props.abstract = entry.abstract;

  return props;
}

function formatAuthor(
  authors: { given?: string; family?: string; literal?: string }[],
): string {
  return authors
    .map((a) => {
      if (a.literal) return a.literal;
      return [a.family, a.given].filter(Boolean).join(', ');
    })
    .join(' and ');
}

function cslTypeToBibLatexType(cslType: string): string {
  const map: Record<string, string> = {
    'article-journal': 'article',
    article: 'article',
    book: 'book',
    chapter: 'incollection',
    'paper-conference': 'inproceedings',
    report: 'techreport',
    thesis: 'phdthesis',
    webpage: 'online',
    manuscript: 'unpublished',
  };
  return map[cslType] ?? 'misc';
}
