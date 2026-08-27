import { Cite, type CSL } from '@citation-js/core';
import type { EntryData, EntryDataCSL, Author } from './types';

// Plugin imports. fetch-ponyfill (used internally by @citation-js/core for
// async HTTP) is aliased in esbuild.config.mjs to stub-fetch-ponyfill.js,
// which routes requests through Obsidian's requestUrl to bypass CORS.
import '@citation-js/plugin-doi';
import '@citation-js/plugin-isbn';
import '@citation-js/plugin-pubmed';
import '@citation-js/plugin-orcid';
import '@citation-js/plugin-url';

export type IdType = 'DOI' | 'ISBN' | 'PubMed' | 'ORCID' | 'URL';

export const ID_TYPES: { value: IdType; label: string; placeholder: string }[] =
  [
    {
      value: 'DOI',
      label: 'DOI',
      placeholder: '10.1016/j.conb.2017.08.010',
    },
    {
      value: 'ISBN',
      label: 'ISBN',
      placeholder: '978-3-030-34308-8',
    },
    {
      value: 'PubMed',
      label: 'PubMed',
      placeholder: '31824580',
    },
    {
      value: 'ORCID',
      label: 'ORCID',
      placeholder: '0000-0002-1825-0097',
    },
    {
      value: 'URL',
      label: 'URL',
      placeholder: 'https://example.com/article',
    },
  ];

function buildQuery(idType: IdType, id: string): string {
  const trimmed = id.trim();
  switch (idType) {
    case 'DOI':
      return `https://doi.org/${trimmed}`;
    case 'ISBN':
      return `isbn:${trimmed}`;
    case 'PubMed':
      return `pmid:${trimmed}`;
    case 'ORCID':
      return `orcid:${trimmed}`;
    case 'URL':
      return trimmed;
  }
}

/**
 * Fetch reference metadata for the given identifier type/value using
 * Citation.js's async input parsers, and return the parsed entries as
 * `EntryData[]`. Throws an `Error` with a user-facing message on failure.
 */
export async function fetchEntryById(
  idType: IdType,
  id: string,
): Promise<EntryData[]> {
  const query = buildQuery(idType, id);
  let cslEntries: CSL[];
  try {
    const cite = await Cite.async(query);
    cslEntries = cite.data;
  } catch (err) {
    throw new Error(
      `Could not fetch ${idType} "${id}". ` +
      'Check your connection and the identifier, then try again.',
      { cause: err },
    );
  }

  if (!cslEntries || cslEntries.length === 0) {
    throw new Error(`No entries found for ${idType} "${id}".`);
  }

  return cslEntries.map((csl) => {
    const { _graph, ...cleanCsl } = csl as Record<string, unknown>;
    return cleanCsl as unknown as EntryDataCSL;
  });
}

/**
 * Generate a BibLaTeX-style citekey: `[lastname][year][word]`.
 *
 * Examples: `Aitchison2017`, `abnar2019blackbox`, `Weiner2003`.
 *
 * - **lastname**: first author's family name (or literal for orgs),
 *   lowercased, non-letters stripped, accents removed.
 * - **year**: four-digit year from `issued.date-parts`, or `nd` if absent.
 * - **word**: first significant word of the title (lowercased, articles
 *   like "the/a/an" skipped), to disambiguate same-author-same-year keys.
 *
 * Collisions with existing keys are resolved by appending `-b`, `-c`, …
 */
export function generateCiteKey(
  entry: EntryDataCSL,
  existing = new Set<string>(),
): string {
  const name = firstAuthorLastName(entry.author);
  const year = entryYear(entry.issued);
  const word = firstTitleWord(entry.title);
  const base = `${name}${year}${word}`;

  let key = base;
  let suffix = 1;
  while (existing.has(key)) {
    const suffixLetter = String.fromCharCode(98 + suffix - 1); // 'b', 'c', ...
    key = `${base}-${suffixLetter}`;
    suffix++;
  }
  return key;
}

function firstAuthorLastName(authors?: Author[]): string {
  if (!authors || authors.length === 0) return 'unknown';
  const first = authors[0];
  if (first.literal) {
    return sanitizeName(first.literal.split(/\s+/).pop() ?? first.literal);
  }
  if (first.family) return sanitizeName(first.family);
  if (first.given) return sanitizeName(first.given);
  return 'unknown';
}

function sanitizeName(name: string): string {
  return deburr(name)
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
}

function entryYear(issued?: { 'date-parts'?: number[][] }): string {
  const year = issued?.['date-parts']?.[0]?.[0];
  return year ? String(year) : 'nd';
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'on',
  'of',
  'and',
  'for',
  'in',
  'to',
  'with',
]);

function firstTitleWord(title?: string): string {
  if (!title) return '';
  const words = deburr(title)
    .replace(/[{}]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, '').toLowerCase())
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return words[0] ?? '';
}

/** Remove diacritics (accents) from a string. */
function deburr(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
