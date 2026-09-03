import { Cite, plugins, type CSL } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import type {
  EntryData,
  EntryDataBibLaTeX,
  EntryDataCSL,
  EntryDataRis,
  FileType,
  RisRawEntry,
} from '../types';

/**
 * Parse raw database text into reference entries.
 *
 * Throws an `Error` with a human-readable message when the input cannot be
 * parsed or fails validation (CSL-JSON shape checks, BibLaTeX or RIS parse
 * failures, or an empty result). The thrown `Error.message` is suitable
 * for direct display to the user.
 *
 * For BibLaTeX, Citation.js parses the input into CSL-JSON (for citeproc)
 * and the raw BibLaTeX properties are attached under `_biblatex` so that
 * `serializeEntries` can round-trip BibLaTeX-specific fields (`file`,
 * `eprint`, `eprinttype`, raw LaTeX `note`). RIS parses directly to
 * CSL-JSON (entries without an `ID` tag get a generated id), with the raw
 * RIS tags attached under `_ris` to round-trip fields the CSL translator
 * drops (`L1`/`L2`/`L3` file links, `AN`, custom tags).
 */
export function deserializeEntries(
  databaseRaw: string,
  extension: FileType,
): EntryDataCSL[] {
  if (extension === 'json') {
    const parsed = parseCslJson(databaseRaw);
    validateCslJsonEntries(parsed);
    return parsed;
  }

  if (extension === 'bib') {
    let cslEntries: CSL[];
    try {
      const cite = new Cite(databaseRaw);
      cslEntries = cite.data;
    } catch (err) {
      console.error(
        'Citation manager: fatal error loading BibLaTeX database:',
        err,
      );
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

  if (extension === 'ris') {
    // Empty (e.g. newly created) files load as an empty library.
    if (!databaseRaw.trim()) return [];

    // Strictly require RIS content, so a misnamed .bib/.json file fails
    // loudly instead of being parsed by another registered input format.
    if (plugins.input.type(databaseRaw) !== '@ris/file') {
      throw new Error('This file could not be parsed as RIS.');
    }

    let cslEntries: CSL[];
    try {
      cslEntries = new Cite(databaseRaw).data;
    } catch (err) {
      console.error('Citation manager: fatal error loading RIS database:', err);
      throw new Error('This file could not be parsed as RIS.', {
        cause: err,
      });
    }

    // Also parse raw records (in file order) to preserve RIS-specific tags
    // that the CSL translator drops (L1/L2/L3 file links, AN, custom tags).
    // Only attach them when the record count matches, so a parse mismatch
    // can never misalign raw records with parsed entries.
    const rawRecords =
      cslEntries.length > 0 ? parseRawRisRecords(databaseRaw) : [];
    const aligned = rawRecords.length === cslEntries.length;

    // Strip Citation.js provenance graph to save memory.
    return cslEntries.map((csl, i) => {
      const { _graph, ...cleanCsl } = csl as Record<string, unknown>;
      return aligned
        ? ({ ...cleanCsl, _ris: rawRecords[i] } as EntryDataRis)
        : (cleanCsl as EntryDataRis);
    });
  }

  throw new Error(`Unsupported file extension: ${extension}.`);
}

const RIS_LINE_MATCH = /^[A-Z][A-Z0-9] {2}-( |$)/;
const RIS_LINE_SPLIT = / {2}-(?: |$)/;

/**
 * Parse raw RIS text into per-record tag maps, mirroring Citation.js's own
 * line parsing (tag regex, continuation-line joining, repeated tags becoming
 * arrays). Records are returned in file order, matching the order of the
 * entries produced by the CSL translator.
 */
function parseRawRisRecords(raw: string): RisRawEntry[] {
  const records: RisRawEntry[] = [];
  let current: RisRawEntry | undefined;
  let lastTag: string | undefined;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!RIS_LINE_MATCH.test(trimmed)) {
      // Continuation of a wrapped value line.
      if (trimmed && current && lastTag) {
        const value = current[lastTag];
        if (Array.isArray(value)) {
          const last = value.length - 1;
          value[last] = `${value[last]} ${trimmed}`;
        } else {
          current[lastTag] = `${value} ${trimmed}`;
        }
      }
      continue;
    }

    const [tag, value = ''] = trimmed.split(RIS_LINE_SPLIT) as [
      string,
      string?,
    ];
    if (tag === 'ER') {
      current = undefined;
      lastTag = undefined;
      continue;
    }
    if (tag === 'TY') {
      current = {};
      records.push(current);
    }
    if (!current) continue;

    if (Array.isArray(current[tag])) {
      current[tag].push(value);
    } else {
      current[tag] = current[tag] ? [current[tag], value] : value;
    }
    lastTag = tag;
  }

  return records;
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
 * For RIS the output is produced by Citation.js's RIS output format, with
 * the raw `_ris` tags (preserved by `deserializeEntries`) re-attached for
 * fields the CSL translator drops (L1/L2/L3 file links, AN, custom tags),
 * and full-length `ID` citekeys (Citation.js truncates `ID` to 20 chars).
 * For BibLaTeX each entry is reconstructed from the raw `_biblatex`
 * properties (preserved by `deserializeEntries` via `chainLink`), which
 * keeps BibLaTeX-specific fields (`file`, `eprint`, `eprinttype`, raw
 * `note`, ...) intact. Entries lacking `_biblatex` fall back to a minimal
 * CSL-derived property set so no data is silently dropped.
 */
export function serializeEntries(
  entries: EntryData[],
  extension: FileType,
): string {
  if (extension === 'json') {
    return serializeCslJson(entries as EntryDataCSL[]);
  }
  if (extension === 'ris') {
    return serializeRis(entries as EntryDataRis[]);
  }
  return serializeBibLaTeX(entries as EntryDataBibLaTeX[]);
}

/**
 * Serialize entries to RIS via Citation.js's RIS output format. Internal
 * fields (`citekey`, `_biblatex`, `_ris`, `_graph`) are stripped first;
 * unknown CSL fields are ignored by the RIS translator.
 */
function serializeRis(entries: EntryDataRis[]): string {
  const clean = entries.map((entry) => {
    const { citekey, _biblatex, _ris, _graph, ...rest } =
      entry as EntryDataRis & {
        citekey?: unknown;
        _biblatex?: unknown;
        _graph?: unknown;
      };
    return rest;
  });

  let output: string;
  try {
    // The 'ris' output format always returns a single string.
    output = new Cite(clean).format('ris') as string;
  } catch (err) {
    console.error(
      'Citation manager: fatal error serializing RIS database:',
      err,
    );
    throw new Error('These entries could not be serialized as RIS.', {
      cause: err,
    });
  }

  if (output) {
    // Citation.js truncates `ID` to 20 characters on output; restore the
    // full-length citekey of the corresponding entry.
    output = restoreRisIds(output, clean);
    // Re-attach raw tags the CSL translator dropped, so saving does not
    // lose file links, accession numbers, or custom tags.
    output = mergeRawRisTags(output, entries);
  }

  return output ? `${output}\n` : '';
}

/**
 * Replace each `ID  - ` line in the formatted output with the full-length
 * id of the corresponding entry (blocks appear in the same order as the
 * entries passed to the formatter).
 */
function restoreRisIds(output: string, entries: { id: string }[]): string {
  const lines = output.split('\n');
  let block = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^TY {2}- /.test(line)) block++;
    if (/^ID {2}- /.test(line)) {
      const id = entries[block]?.id;
      if (id) lines[i] = `ID  - ${id}`;
    }
  }

  return lines.join('\n');
}

/**
 * For each formatted block, append the entry's raw `_ris` tags that the
 * formatter did not emit (e.g. L1/L2/L3, AN, custom tags), so they survive
 * load → save round trips. Tags already present in the block are left as
 * formatted (edits made through the plugin win over the raw values).
 */
function mergeRawRisTags(output: string, entries: EntryDataRis[]): string {
  const lines = output.split('\n');
  const result: string[] = [];
  const seenTags = new Set<string>();
  let block = -1;

  for (const line of lines) {
    if (/^TY {2}- /.test(line)) {
      block++;
      seenTags.clear();
    }

    const tagMatch = /^([A-Z][A-Z0-9]) {2}- /.exec(line);
    if (tagMatch) seenTags.add(tagMatch[1]!);

    if (/^ER {2}- ?$/.test(line)) {
      const raw = entries[block]?._ris;
      if (raw) {
        for (const [tag, value] of Object.entries(raw)) {
          if (tag === 'TY' || tag === 'ER' || seenTags.has(tag)) continue;
          for (const v of ([] as string[]).concat(value)) {
            if (v !== undefined && v !== null) result.push(`${tag}  - ${v}`);
          }
        }
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

function serializeCslJson(entries: EntryDataCSL[]): string {
  const clean = entries.map((entry) => {
    const { _biblatex, _ris, _graph, ...rest } = entry as EntryDataCSL & {
      _biblatex?: unknown;
      _ris?: unknown;
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
  if (entry.month) props.month = entry.month;
  if (entry.year) props.year = entry.year;
  if (entry.issued?.['date-parts']?.[0]) {
    const parts = entry.issued['date-parts'][0];
    if (parts.length === 1) {
      props.year = String(parts[0]);
    } else if (parts.length === 3) {
      props.date = parts.join('-');
    }
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
  if (entry.language) props.language = entry.language;

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
