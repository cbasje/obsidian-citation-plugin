import {
  createEngine,
  standardFilters,
  type TemplateFilter,
  type TemplateVariables,
} from 'knap';

/**
 * A `file_link` filter for reference `files` values: vault-relative
 * paths become wikilinks (`[[papers/x.pdf]]`), external URLs (https,
 * file, zotero) become Markdown links labeled with the file name.
 * Applies recursively to arrays and objects, like Knap's standard
 * Markdown filters.
 */
const FILE_URL_RE = /^(https?|file|zotero):\/\//i;

function formatFileLink(value: string): string {
  if (FILE_URL_RE.test(value)) {
    const label = value.split('/').pop() || value;
    return `"[${label}](${value})"`;
  }
  return `"[[${value}]]"`;
}

function mapFileLinks(value: unknown): unknown {
  if (typeof value === 'string') return formatFileLink(value);
  if (Array.isArray(value)) return value.map(mapFileLinks);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapFileLinks(item)]),
    );
  }
  return value;
}

const fileLink: TemplateFilter = (value, _param, context) => {
  const raw = context?.rawValue;
  const input =
    Array.isArray(raw) || (raw && typeof raw === 'object') ? raw : value;
  return mapFileLinks(input);
};
fileLink.metadata = { example: 'files | file_link' };

/**
 * Shared Knap template engine (the template language used by Obsidian's
 * Web Clipper and Importer). Rendering is asynchronous, so all template
 * consumers must await the result.
 */
const engine = createEngine({
  filters: { ...standardFilters, file_link: fileLink },
});

export async function renderTemplate(
  template: string,
  variables: TemplateVariables,
): Promise<string> {
  return engine.renderOrThrow(template, { variables });
}
