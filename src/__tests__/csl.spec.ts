import * as fs from 'fs';
import * as path from 'path';

import { loadEntries, EntryDataBibLaTeX } from '../types';
import { bibLaTeXToCsl } from '../csl/biblatex-to-csl';
import { CslItemRegistry } from '../csl/registry';
import { CiteprocEngine } from '../csl/engine';

function loadBibLaTeXEntries(filename: string): EntryDataBibLaTeX[] {
  const biblatexPath = path.join(__dirname, filename);
  const biblatex = fs.readFileSync(biblatexPath, 'utf-8');
  return loadEntries(biblatex, 'biblatex') as EntryDataBibLaTeX[];
}

describe('biblatex-to-csl converter', () => {
  let entries: EntryDataBibLaTeX[];

  beforeEach(() => {
    entries = loadBibLaTeXEntries('library.bib');
  });

  test('maps core fields', () => {
    const csl = bibLaTeXToCsl(entries[2]); // aitchison2017you

    expect(csl.id).toBe('aitchison2017you');
    expect(csl.type).toBe('article-journal');
    expect(csl.title).toBe(
      'With or without you: Predictive coding and Bayesian inference in the brain',
    );
    expect(csl['container-title']).toBe('Current Opinion in Neurobiology');
    expect(csl.DOI).toBe('10.1016/j.conb.2017.08.010');
    expect(csl.page).toBe('219–227');
    expect(csl.ISSN).toBe('0959-4388');
    expect(csl.volume).toBe('46');
    expect(csl.issued['date-parts'][0]).toEqual([2017, 10, 1]);
  });

  test('maps authors', () => {
    const csl = bibLaTeXToCsl(entries[2]);
    expect(csl.author).toHaveLength(2);
    expect(csl.author[0]).toEqual({
      family: 'Aitchison',
      given: 'Laurence',
    });
  });

  test('maps book type', () => {
    const csl = bibLaTeXToCsl(entries[4]); // bar-ashersiegal2020perspectives
    expect(csl.type).toBe('book');
    expect(csl.publisher).toBe('Springer International Publishing');
    expect(csl['publisher-place']).toBe('Cham');
  });

  test('maps online type to webpage', () => {
    const csl = bibLaTeXToCsl(entries[1]); // abnar2019blackbox
    expect(csl.type).toBe('webpage');
    expect(csl.URL).toBe('http://arxiv.org/abs/1906.01539');
  });

  test('falls back to document for unknown types', () => {
    const fake = ({
      key: 'x',
      type: 'somethingweird',
      fields: { title: ['T'] },
      creators: {},
    } as unknown) as EntryDataBibLaTeX;
    expect(bibLaTeXToCsl(fake).type).toBe('document');
  });
});

describe('CslItemRegistry', () => {
  let entries: EntryDataBibLaTeX[];

  beforeEach(() => {
    entries = loadBibLaTeXEntries('library.bib');
  });

  test('loads and retrieves items', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    expect(reg.size).toBe(entries.length);
    expect(reg.has('aitchison2017you')).toBe(true);
    expect(reg.has('nonexistent')).toBe(false);

    const item = reg.retrieve('aitchison2017you');
    expect(item.id).toBe('aitchison2017you');
    expect(item.title).toBeDefined();
  });
});

describe('CiteprocEngine integration', () => {
  let entries: EntryDataBibLaTeX[];

  beforeEach(() => {
    entries = loadBibLaTeXEntries('library.bib');
  });

  test('renders an APA bibliography', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderBibliography(['aitchison2017you']);
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Aitchison');
    expect(html[0]).toContain('Lengyel');
    expect(html[0]).toContain('2017');
  });

  test('renders multiple entries sorted', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderBibliography([
      'aitchison2017you',
      'Weiner2003',
      'alexandrescu2006factored',
    ]);
    expect(html).toHaveLength(3);
  });

  test('renders an in-text citation cluster', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const cluster = engine.renderCitationCluster(['aitchison2017you']);
    expect(cluster).toContain('Aitchison');
    expect(cluster).toContain('2017');
  });

  test('renders with IEEE style', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('ieee');

    const html = engine.renderBibliography(['aitchison2017you']);
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Aitchison');
  });

  test('renders with Chicago author-date style', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('chicago-author-date');

    const html = engine.renderBibliography(['aitchison2017you']);
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Aitchison');
  });
});

describe('CiteprocEngine inline citations', () => {
  let entries: EntryDataBibLaTeX[];

  beforeEach(() => {
    entries = loadBibLaTeXEntries('library.bib');
  });

  test('renders a single inline citation', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitation([{ id: 'aitchison2017you' }]);
    expect(html).toContain('Aitchison');
    expect(html).toContain('2017');
  });

  test('renders multiple citations in one cluster', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitation([
      { id: 'aitchison2017you' },
      { id: 'Weiner2003' },
    ]);
    expect(html).toContain('Aitchison');
    expect(html).toContain('Weiner');
  });

  test('renders suppress-author citation', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitation([
      { id: 'aitchison2017you', 'suppress-author': true },
    ]);
    // Should contain the year but not the author name as the primary element.
    expect(html).toContain('2017');
  });

  test('renders with locator', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitation([
      { id: 'aitchison2017you', locator: 'p. 220' },
    ]);
    expect(html).toContain('220');
  });

  test('is stateless (safe for re-render)', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const first = engine.renderInlineCitation([{ id: 'aitchison2017you' }]);
    const second = engine.renderInlineCitation([{ id: 'aitchison2017you' }]);
    // previewCitationCluster should produce the same output on repeated calls.
    expect(first).toBe(second);
  });

  test('returns empty for unknown citekeys', () => {
    const reg = new CslItemRegistry();
    reg.load(entries, 'biblatex');

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitation([{ id: 'nonexistent' }]);
    expect(html).toBe('');
  });
});
