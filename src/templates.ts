import { createEngine, standardFilters } from 'knap';
import type { TemplateVariables } from 'knap';

/**
 * Shared Knap template engine (the template language used by Obsidian's
 * Web Clipper and Importer). Rendering is asynchronous, so all template
 * consumers must await the result.
 */
const engine = createEngine({ filters: standardFilters });

export async function renderTemplate(
  template: string,
  variables: TemplateVariables,
): Promise<string> {
  return engine.renderOrThrow(template, { variables });
}
