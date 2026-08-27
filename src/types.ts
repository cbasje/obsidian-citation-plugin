// Trick: allow string indexing onto object properties
export interface IIndexable {
  [key: string]: any;
}

export const fileTypes = ['bib', 'json'] as const;
export type FileType = (typeof fileTypes)[number];
export const CIT_VIEW_TYPE = 'citation-manager';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const databaseTypes = ['csl-json', 'biblatex'] as const;
export type DatabaseType = (typeof databaseTypes)[number];

export const TEMPLATE_VARIABLES = {
  citekey: 'Unique citekey',
  abstract: '',
  authorString: 'Comma-separated list of author names',
  containerTitle:
    'Title of the container holding the reference (e.g. book title for a book chapter, or the journal title for a journal article)',
  DOI: '',
  eprint: '',
  eprinttype: '',
  eventPlace: 'Location of event',
  files:
    'List of associated file paths (e.g. PDFs) from the reference database',
  note: '',
  page: 'Page or page range',
  publisher: '',
  publisherPlace: 'Location of publisher',
  title: '',
  titleShort: '',
  URL: '',
  year: 'Publication year',
  zoteroSelectURI: 'URI to open the reference in Zotero',
};

/**
 * A flat metadata object extracted from a reference entry, used for
 * literature note templates and modal display.
 */
export interface EntryMetadata {
  citekey: string;
  id: string;
  type: string;
  abstract?: string;
  author?: Author[];
  authorString?: string;
  containerTitle?: string;
  containerTitleShort?: string;
  DOI?: string;
  files?: string[];
  page?: string;
  title?: string;
  titleShort?: string;
  URL?: string;
  eventPlace?: string;
  publisher?: string;
  publisherPlace?: string;
  eprint?: string;
  eprinttype?: string;
  year?: string;
  note?: string;
  zoteroSelectURI: string;

  [key: string]: any;
}

/**
 * Raw BibLaTeX entry as produced by Citation.js's `chainLink` parser.
 * Field names are lowercased. Values are strings.
 */
export interface BibLaTeXRawEntry {
  label: string;
  type: string;
  properties: Record<string, string>;
}

/**
 * Extract a flat metadata object from a parsed reference entry, for either
 * CSL-JSON or BibLaTeX databases.
 */
export function getEntryMetadata(
  citekey: string,
  entry: EntryData,
  databaseType: DatabaseType,
  basePath?: string,
): EntryMetadata {
  return databaseType === 'csl-json'
    ? getCSLMetadata(citekey, entry as EntryDataCSL)
    : getBibLaTeXMetadata(citekey, entry as EntryDataBibLaTeX, basePath);
}

function getCSLMetadata(citekey: string, data: EntryDataCSL): EntryMetadata {
  const authorString = data.author
    ? data.author
      .map((a) => {
        if (a.literal) return a.literal;
        return [a.given, a.family].filter(Boolean).join(' ');
      })
      .join(', ')
    : undefined;

  const year = data.issued?.['date-parts']?.[0]?.[0]?.toString();

  return {
    citekey,
    id: data.id,
    type: data.type,
    abstract: data.abstract,
    author: data.author,
    authorString,
    containerTitle: data['container-title'],
    containerTitleShort: data['container-title-short'],
    DOI: data.DOI,
    files: undefined,
    page: data.page,
    title: data.title,
    titleShort: data['title-short'],
    URL: data.URL,
    eventPlace: data['event-place'],
    publisher: data.publisher,
    publisherPlace: data['publisher-place'],
    eprint: undefined,
    eprinttype: undefined,
    year,
    note: undefined,
    zoteroSelectURI: `zotero://select/items/@${data.id}`,
  };
}

/**
 * Extract metadata from a BibLaTeX entry that has been parsed by Citation.js
 * into CSL-JSON (for standard fields) with the raw BibLaTeX properties
 * attached under `_biblatex` (for BibLaTeX-specific fields like `file`,
 * `eprint`, `eprinttype`, and raw LaTeX `note`).
 */
function getBibLaTeXMetadata(
  citekey: string,
  data: EntryDataBibLaTeX,
  basePath?: string,
): EntryMetadata {
  const raw = data._biblatex?.properties || {};

  // Author string from CSL authors (parsed into {given, family} by Citation.js)
  const authorString = data.author
    ? data.author
      .map((a) => {
        if (a.literal) return a.literal;
        return [a.given, a.family].filter(Boolean).join(' ');
      })
      .join(', ')
    : undefined;

  // Container title: prefer CSL, fall back to raw BibLaTeX fields, then
  // construct from eprint for arXiv-style entries with no journal.
  const containerTitle =
    (data['container-title'] as string) ||
    raw.journaltitle ||
    raw.journal ||
    raw.booktitle ||
    raw.eventtitle;
  let resolvedContainerTitle = containerTitle;
  if (!resolvedContainerTitle && raw.eprint) {
    const prefix = raw.eprinttype ? `${raw.eprinttype}:` : '';
    const primaryclass = raw.primaryclass || raw.primaryClass;
    const suffix = primaryclass ? ` [${primaryclass}]` : '';
    resolvedContainerTitle = `${prefix}${raw.eprint}${suffix}`;
  }

  // Year from CSL issued date-parts
  const year = data.issued?.['date-parts']?.[0]?.[0]?.toString();

  // Note: use raw BibLaTeX (LaTeX formatting preserved), not CSL (HTML).
  // Format Zotero select links as Markdown.
  const noteRaw = raw.note;
  const note = noteRaw
    ? noteRaw.replace(/(zotero:\/\/.+)/g, '[Link]($1)')
    : undefined;

  // Files — parse Better BibTeX file entries into usable links
  let files: string[] = [];
  if (raw.file) files = files.concat(raw.file.split(';'));
  if (raw.files) files = files.concat(raw.files.split(';'));
  files = files
    .map((f) => parseFileEntry(f, basePath))
    .filter(Boolean) as string[];

  return {
    citekey,
    id: data.id,
    type: data.type,
    abstract: data.abstract,
    author: data.author,
    authorString,
    containerTitle: resolvedContainerTitle,
    containerTitleShort:
      (data['container-title-short'] as string) || raw.shortjournal,
    DOI: data.DOI,
    files: files.length > 0 ? files : undefined,
    page: data.page,
    title: data.title,
    titleShort: data['title-short'],
    URL: data.URL,
    eventPlace: (data['event-place'] as string) || raw.venue,
    publisher: data.publisher,
    publisherPlace: data['publisher-place'] || raw.location,
    eprint: raw.eprint,
    eprinttype: raw.eprinttype,
    year,
    note,
    zoteroSelectURI: `zotero://select/items/@${data.id}`,
  };
}

/**
 * Parse a single file entry from a BibLaTeX `file` field and return the best
 * usable link (a URL or a `file://` path).
 *
 * Better BibTeX encodes file attachments as colon-separated fields with
 * `\:` escaping literal colons:
 *
 *   description:filename:type:url
 */
function parseFileEntry(raw: string, _basePath?: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // Split by unescaped colons (\: is a literal colon within a field)
  const PLACEHOLDER = '\u0000';
  const parts = s
    .replace(/\\:/g, PLACEHOLDER)
    .split(':')
    .map((p) => p.replace(new RegExp(PLACEHOLDER, 'g'), ':'));

  const FILE_TYPE = /^(pdf|epub|txt|html?|docx?|rtf|odt|tex|dvi|ps)$/i;

  let pathPart: string | undefined;
  let url: string | undefined;

  if (parts.length >= 4) {
    // description:filename:type:url
    pathPart = parts[1]!.trim();
    url = parts[3]!.trim();
  } else if (parts.length === 3) {
    // description:filename:type  (description may be empty for old format)
    pathPart = parts[1]!.trim();
  } else if (parts.length === 2) {
    // path:type  (no description field)
    if (FILE_TYPE.test(parts[1]!.trim())) {
      pathPart = parts[0]!.trim();
    } else {
      // description:path  (no type)
      pathPart = parts[1]!.trim();
    }
  } else {
    // plain path
    pathPart = parts[0]!.trim();
  }

  // Resolve relative paths against the .bib file directory.
  // Only treat the filename as a local path if it's absolute or contains a
  // directory separator — a bare filename like "paper.pdf" is not usable as
  // a local link, so fall through to the URL.
  if (pathPart) {
    const isAbsolute =
      pathPart.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pathPart);
    if (isAbsolute) {
      return 'file://' + pathPart;
    }
    // File is local
    if (pathPart.includes('/')) {
      return `[[${pathPart}]]`;
    }
  }

  // Fall back to URL
  if (url) return url;

  return undefined;
}

export class Library {
  public entries: { [citekey: string]: EntryMetadata };

  constructor(
    entries: EntryData[],
    databaseType: DatabaseType,
    basePath?: string,
  ) {
    this.entries = {};
    for (const entry of entries) {
      const id = (entry as EntryDataCSL).id;
      this.entries[id] = getEntryMetadata(id, entry, databaseType, basePath);
    }
  }

  get size(): number {
    return Object.keys(this.entries).length;
  }

  /**
   * For the given citekey, return a flat object of template variables.
   * All metadata fields are available both at the top level (`{{title}}`)
   * and via `{{entry.title}}`.
   */
  getTemplateVariablesForCitekey(citekey: string): Record<string, any> {
    const entry = this.entries[citekey];
    return entry ? { entry, ...entry } : {};
  }
}

export interface Author {
  given?: string;
  family?: string;
  literal?: string;
  suffix?: string;
  'non-dropping-particle'?: string;
}

/**
 * A CSL-JSON entry with the raw BibLaTeX properties attached.
 * Only present when the database type is `biblatex`.
 */
export type EntryDataBibLaTeX = EntryDataCSL & {
  _biblatex?: BibLaTeXRawEntry;
};

export type EntryData = EntryDataCSL | EntryDataBibLaTeX;

export interface EntryDataCSL {
  id: string;
  type: string;

  abstract?: string;
  author?: Author[];
  'container-title'?: string;
  'container-title-short'?: string;
  'collection-title'?: string;
  DOI?: string;
  'event-place'?: string;
  edition?: string;

  issued?: { 'date-parts': [any[]] };
  ISBN?: string;
  ISSN?: string;
  issue?: string;
  keyword?: string;
  language?: string;
  page?: string;
  publisher?: string;
  'publisher-place'?: string;
  'title-short'?: string;
  title?: string;
  URL?: string;
  volume?: string;

  [key: string]: any;
}
