import * as fs from 'fs';
import * as path from 'path';

import { type EntryDataBibLaTeX } from '../types';
import { deserializeEntries } from '../serializer';
import { CslItemRegistry } from '../csl/registry';
import { CiteprocEngine } from '../csl/engine';

function loadBibLaTeXEntries(filename: string): EntryDataBibLaTeX[] {
  const biblatexPath = path.join(__dirname, filename);
  const biblatex = fs.readFileSync(biblatexPath, 'utf-8');
  return deserializeEntries(biblatex, 'bib') as EntryDataBibLaTeX[];
}

describe('Citation.js BibLaTeX → CSL conversion', () => {
  let entries: EntryDataBibLaTeX[];

  beforeEach(() => {
    entries = loadBibLaTeXEntries('library.bib');
  });

  test('maps core fields', () => {
    const csl = entries[2]; // aitchison2017you

    expect(csl.id).toBe('aitchison2017you');
    expect(csl.type).toBe('article-journal');
    expect(csl.title).toBe(
      'With or without You: Predictive Coding and Bayesian Inference in the Brain',
    );
    expect(csl['container-title']).toBe('Current Opinion in Neurobiology');
    expect(csl.DOI).toBe('10.1016/j.conb.2017.08.010');
    expect(csl.page).toBe('219-227');
    expect(csl.ISSN).toBe('0959-4388');
    expect(csl.volume).toBe('46');
    expect(csl.issued['date-parts'][0]).toEqual([2017, 10, 1]);
  });

  test('maps authors', () => {
    const csl = entries[2];
    expect(csl.author).toHaveLength(2);
    expect(csl.author[0]).toEqual({
      given: 'Laurence',
      family: 'Aitchison',
    });
  });

  test('maps book type', () => {
    const csl = entries[4]; // bar-ashersiegal2020perspectives
    expect(csl.type).toBe('book');
    expect(csl.publisher).toBe('Springer International Publishing');
    expect(csl['publisher-place']).toBe('Cham');
  });

  test('maps online type to webpage', () => {
    const csl = entries[1]; // abnar2019blackbox
    expect(csl.type).toBe('webpage');
    expect(csl.URL).toBe('http://arxiv.org/abs/1906.01539');
  });

  test('preserves BibLaTeX-specific fields in _biblatex', () => {
    const entry1 = entries[1]; // abnar2019blackbox
    expect(entry1._biblatex?.properties.eprint).toBe('1906.01539');
    expect(entry1._biblatex?.properties.eprinttype).toBe('arxiv');

    const entry2 = entries[2]; // aitchison2017you
    expect(entry2._biblatex?.properties.shortjournal).toBe(
      'Current Opinion in Neurobiology',
    );
  });

  test('preserves file field in _biblatex', () => {
    const entry0 = entries[0]; // Weiner2003
    expect(entry0._biblatex?.properties.file).toContain('Weiner');

    const entry2 = entries[2]; // aitchison2017you
    expect(entry2._biblatex?.properties.file).toContain('Aitchison');
  });
});

describe('CslItemRegistry', () => {
  let entries: EntryDataBibLaTeX[];

  beforeEach(() => {
    entries = loadBibLaTeXEntries('library.bib');
  });

  test('loads and retrieves items', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

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
    reg.load(entries);

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
    reg.load(entries);

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
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const cluster = engine.renderCitationCluster(['aitchison2017you']);
    expect(cluster).toContain('Aitchison');
    expect(cluster).toContain('2017');
  });

  test('renders with IEEE style', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('ieee');

    const html = engine.renderBibliography(['aitchison2017you']);
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Aitchison');
  });

  test('renders with Chicago author-date style', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

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
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you' }],
    ]);
    expect(html[0]).toContain('Aitchison');
    expect(html[0]).toContain('2017');
  });

  test('renders multiple citations in one cluster', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you' }, { id: 'Weiner2003' }],
    ]);
    expect(html[0]).toContain('Aitchison');
    expect(html[0]).toContain('Weiner');
  });

  test('renders suppress-author citation', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you', 'suppress-author': true }],
    ]);
    expect(html[0]).toContain('2017');
  });

  test('renders with locator', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you', locator: 'p. 220' }],
    ]);
    expect(html[0]).toContain('220');
  });

  test('returns empty for unknown citekeys', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const html = engine.renderInlineCitationsBatch([[{ id: 'nonexistent' }]]);
    expect(html).toEqual(['']);
  });

  test('IEEE assigns correct citation numbers in batch', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('ieee');

    const results = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you' }],
      [{ id: 'Weiner2003' }],
      [{ id: 'alexandrescu2006factored' }],
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]).toContain('1');
    expect(results[1]).toContain('2');
    expect(results[2]).toContain('3');
  });

  test('IEEE is stateless across repeated batch renders', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('ieee');

    const first = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you' }],
      [{ id: 'Weiner2003' }],
    ]);
    const second = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you' }],
      [{ id: 'Weiner2003' }],
    ]);

    expect(first).toEqual(second);
  });

  test('APA inline batch still works (author-date style)', () => {
    const reg = new CslItemRegistry();
    reg.load(entries);

    const engine = new CiteprocEngine(reg);
    engine.configure('apa');

    const results = engine.renderInlineCitationsBatch([
      [{ id: 'aitchison2017you' }],
    ]);

    expect(results[0]).toContain('Aitchison');
    expect(results[0]).toContain('2017');
  });
});
