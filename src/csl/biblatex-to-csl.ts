import { EntryDataBibLaTeX } from '../types';
import { EntryDataCSL } from '../types';

/**
 * Mapping from BibLaTeX entry types to CSL item types.
 *
 * BibLaTeX types are open-ended; unknown types fall back to `document`.
 */
const BIBLATEX_TYPE_TO_CSL: Record<string, string> = {
  article: 'article-journal',
  book: 'book',
  booklet: 'pamphlet',
  inbook: 'chapter',
  incollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  manual: 'report',
  mastersthesis: 'thesis',
  phdthesis: 'thesis',
  misc: 'document',
  online: 'webpage',
  patent: 'patent',
  proceedings: 'book',
  techreport: 'report',
  unpublished: 'manuscript',
  report: 'report',
  thesis: 'thesis',
  software: 'software',
  dataset: 'dataset',
};

/**
 * Convert a BibLaTeX entry (as produced by `@retorquere/bibtex-parser`) into a
 * CSL-JSON item suitable for feeding to citeproc-js.
 *
 * BibLaTeX field values are arrays; we take the first element for scalar
 * fields.  Creators are mapped to `{ family, given }` pairs.
 */
export function bibLaTeXToCsl(entry: EntryDataBibLaTeX): EntryDataCSL {
  const fields = entry.fields || {};
  const creators = entry.creators || {};

  const first = (key: string): string | undefined => {
    const val = fields[key];
    return Array.isArray(val) && val.length > 0 ? val[0] : undefined;
  };

  const item: EntryDataCSL = {
    id: entry.key,
    type: BIBLATEX_TYPE_TO_CSL[entry.type] || 'document',
  };

  const title = first('title');
  if (title) item.title = title;

  const shorttitle = first('shorttitle');
  if (shorttitle) item['title-short'] = shorttitle;

  // Container title: journaltitle / booktitle / eventtitle
  const containerTitle =
    first('journaltitle') ||
    first('journal') ||
    first('booktitle') ||
    first('eventtitle');
  if (containerTitle) item['container-title'] = containerTitle;

  const containerTitleShort = first('shortjournal');
  if (containerTitleShort) item['container-title-short'] = containerTitleShort;

  // Authors / editors
  const mapNames = (
    list:
      | {
          firstName?: string;
          lastName?: string;
          prefix?: string;
          suffix?: string;
          literal?: string;
        }[]
      | undefined,
  ) =>
    list?.map((n) => {
      if (n.literal) return { literal: n.literal };
      return {
        family: n.lastName,
        given: n.firstName,
        ...(n.suffix ? { suffix: n.suffix } : {}),
        ...(n.prefix ? { 'non-dropping-particle': n.prefix } : {}),
      };
    });

  const author = mapNames(creators.author);
  if (author) item.author = author;

  const editor = mapNames(creators.editor);
  if (editor) item.editor = editor;

  // Date → issued date-parts
  const dateRaw = first('date') || first('year');
  if (dateRaw) {
    const parts = parseDateParts(dateRaw);
    if (parts.length > 0) {
      item.issued = { 'date-parts': [parts] };
    }
  }

  const page = first('pages');
  if (page) item.page = page;

  const doi = first('doi');
  if (doi) item.DOI = doi;

  const url = first('url');
  if (url) item.URL = url;

  const publisher = first('publisher');
  if (publisher) item.publisher = publisher;

  const location = first('location');
  if (location) item['publisher-place'] = location;

  const venue = first('venue');
  if (venue) item['event-place'] = venue;

  const volume = first('volume');
  if (volume) item.volume = volume;

  // BibLaTeX `number` usually maps to CSL `issue` for journals.
  const number = first('number');
  if (number) item.issue = number;

  const edition = first('edition');
  if (edition) item.edition = edition;

  const abstract = first('abstract');
  if (abstract) item.abstract = abstract;

  const language = first('langid') || first('language');
  if (language) item.language = language;

  const isbn = first('isbn');
  if (isbn) item.ISBN = isbn;

  const issn = first('issn');
  if (issn) item.ISSN = issn;

  const keywords = first('keywords');
  if (keywords) item.keyword = keywords;

  return item;
}

/**
 * Parse a BibLaTeX date string into numeric date-parts.
 *
 * Supports `YYYY`, `YYYY-MM-DD`, and ranges `YYYY-MM/DD` (we take the start).
 */
function parseDateParts(raw: string): number[] {
  const trimmed = raw.trim();
  // Take the start of a range (before `/`).
  const start = trimmed.split('/')[0].trim();

  // Handle `date-parts` style already encoded, or plain year.
  const numeric = start.match(/^(-?\d{3,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (numeric) {
    const parts = [parseInt(numeric[1], 10)];
    if (numeric[2]) parts.push(parseInt(numeric[2], 10));
    if (numeric[3]) parts.push(parseInt(numeric[3], 10));
    return parts;
  }

  // Fall back to a bare 4-digit year anywhere in the string.
  const yearOnly = start.match(/(-?\d{4})/);
  if (yearOnly) return [parseInt(yearOnly[1], 10)];

  return [];
}
