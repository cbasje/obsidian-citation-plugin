import * as BibTeXParser from '@retorquere/bibtex-parser';
import { Entry as EntryDataBibLaTeX } from '@retorquere/bibtex-parser';
// Also make EntryDataBibLaTeX available to other modules
export { Entry as EntryDataBibLaTeX } from '@retorquere/bibtex-parser';

// Trick: allow string indexing onto object properties
export interface IIndexable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const databaseTypes = ['csl-json', 'biblatex'] as const;
export type DatabaseType = typeof databaseTypes[number];

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Extract a flat metadata object from a parsed reference entry, for either
 * CSL-JSON or BibLaTeX databases. This replaces the old `Entry` adapter
 * class hierarchy.
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

function getBibLaTeXMetadata(
  citekey: string,
  data: EntryDataBibLaTeX,
  basePath?: string,
): EntryMetadata {
  const fields = data.fields || {};
  const creators = data.creators || {};

  const first = (key: string): string | undefined => {
    const val = fields[key];
    return Array.isArray(val) && val.length > 0 ? val[0] : undefined;
  };

  // Author string
  let authorString: string | undefined;
  const authorCreators = creators.author;
  if (authorCreators) {
    authorString = authorCreators
      .map((name) => {
        if (name.literal) return name.literal;
        const parts = [name.firstName, name.prefix, name.lastName, name.suffix];
        return parts.filter(Boolean).join(' ');
      })
      .join(', ');
  } else {
    authorString = fields.author?.join(', ');
  }

  // Container title (with eprint fallback for arXiv etc.)
  const containerTitle =
    first('journaltitle') || first('journal') || first('booktitle');
  let resolvedContainerTitle = containerTitle;
  if (!resolvedContainerTitle && fields.eprint) {
    const prefix = first('eprinttype') ? `${first('eprinttype')}:` : '';
    const primaryclass = first('primaryclass') || first('primaryClass');
    const suffix = primaryclass ? ` [${primaryclass}]` : '';
    resolvedContainerTitle = `${prefix}${first('eprint')}${suffix}`;
  }

  // Year
  const yearRaw = first('year') || first('date');
  const year = yearRaw ? parseYear(yearRaw) : undefined;

  // Note (with Zotero link formatting)
  const noteArr = fields.note;
  const note = noteArr
    ? noteArr
        .map((el) => el.replace(/(zotero:\/\/.+)/g, '[Link]($1)'))
        .join('\n\n')
    : undefined;

  // Files — parse Better BibTeX file entries into usable links
  let files: string[] = [];
  if (fields.file)
    files = files.concat(fields.file.flatMap((x) => x.split(';')));
  if (fields.files)
    files = files.concat(fields.files.flatMap((x) => x.split(';')));
  files = files
    .map((f) => parseFileEntry(f, basePath))
    .filter(Boolean) as string[];

  // Author (Author[] for templates)
  const author: Author[] | undefined = authorCreators?.map((a) => ({
    given: a.firstName,
    family: a.lastName,
  }));

  return {
    citekey,
    id: data.key,
    type: data.type,
    abstract: first('abstract'),
    author,
    authorString,
    containerTitle: resolvedContainerTitle,
    containerTitleShort: first('shortjournal'),
    DOI: first('doi'),
    files: files.length > 0 ? files : undefined,
    page: first('pages'),
    title: first('title'),
    titleShort: first('shorttitle'),
    URL: first('url'),
    eventPlace: first('venue'),
    publisher: first('publisher'),
    publisherPlace: first('location'),
    eprint: first('eprint'),
    eprinttype: first('eprinttype'),
    year,
    note,
    zoteroSelectURI: `zotero://select/items/@${data.key}`,
  };
}

function parseYear(raw: string): string | undefined {
  const m = raw.match(/(-?\d{4})/);
  return m ? m[1] : undefined;
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
function parseFileEntry(raw: string, basePath?: string): string | undefined {
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
    pathPart = parts[1].trim();
    url = parts[3].trim();
  } else if (parts.length === 3) {
    // description:filename:type  (description may be empty for old format)
    pathPart = parts[1].trim();
  } else if (parts.length === 2) {
    // path:type  (no description field)
    if (FILE_TYPE.test(parts[1].trim())) {
      pathPart = parts[0].trim();
    } else {
      // description:path  (no type)
      pathPart = parts[1].trim();
    }
  } else {
    // plain path
    pathPart = parts[0].trim();
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
    const idKey = databaseType === 'biblatex' ? 'key' : 'id';
    for (const entry of entries) {
      const id = (entry as IIndexable)[idKey] as string;
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
  getTemplateVariablesForCitekey(
    citekey: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Record<string, any> {
    const entry = this.entries[citekey];
    return entry ? { entry, ...entry } : {};
  }
}

/**
 * Load reference entries from the given raw database data.
 *
 * Returns a list of `EntryData`, which should be passed to the `Library`
 * constructor along with the database type.
 */
export function loadEntries(
  databaseRaw: string,
  databaseType: DatabaseType,
): EntryData[] {
  let libraryArray: EntryData[];

  if (databaseType == 'csl-json') {
    libraryArray = JSON.parse(databaseRaw);
  } else if (databaseType == 'biblatex') {
    const options: BibTeXParser.ParserOptions = {
      errorHandler: (err) => {
        console.warn(
          'Citation plugin: non-fatal error loading BibLaTeX entry:',
          err,
        );
      },
    };

    const parsed = BibTeXParser.parse(
      databaseRaw,
      options,
    ) as BibTeXParser.Bibliography;

    parsed.errors.forEach((error) => {
      console.error(
        `Citation plugin: fatal error loading BibLaTeX entry` +
          ` (line ${error.line}, column ${error.column}):`,
        error.message,
      );
    });

    libraryArray = parsed.entries;
  }

  return libraryArray;
}

export interface Author {
  given?: string;
  family?: string;
  literal?: string;
  suffix?: string;
  'non-dropping-particle'?: string;
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
