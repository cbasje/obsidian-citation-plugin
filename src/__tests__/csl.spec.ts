import * as fs from 'fs';
import * as path from 'path';
import { CitationDatabase } from '../database';
import { buildFile } from './utils';

function loadBibLaTeXEntries(filename: string): string {
  const biblatexPath = path.join(__dirname, filename);
  return fs.readFileSync(biblatexPath, 'utf-8');
}

describe('Citation.js BibLaTeX → CSL conversion', () => {
  const db = new CitationDatabase(buildFile('bib'));

  beforeEach(async () => {
    await db.deserialize(loadBibLaTeXEntries('library.bib'));
  });

  test('maps core fields', () => {
    const entries = Array.from(db.entries.values());
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
    const entries = Array.from(db.entries.values());
    const csl = entries[2];
    expect(csl.author).toHaveLength(2);
    expect(csl.author[0]).toEqual({
      given: 'Laurence',
      family: 'Aitchison',
    });
  });

  test('maps book type', () => {
    const entries = Array.from(db.entries.values());
    const csl = entries[4]; // bar-ashersiegal2020perspectives
    expect(csl.type).toBe('book');
    expect(csl.publisher).toBe('Springer International Publishing');
    expect(csl['publisher-place']).toBe('Cham');
  });

  test('maps online type to webpage', () => {
    const entries = Array.from(db.entries.values());
    const csl = entries[1]; // abnar2019blackbox
    expect(csl.type).toBe('webpage');
    expect(csl.URL).toBe('http://arxiv.org/abs/1906.01539');
  });

  test('preserves BibLaTeX-specific fields in _biblatex', () => {
    const entries = Array.from(db.entriesRich.values());

    const entry1 = entries[1]; // abnar2019blackbox
    expect(entry1._biblatex?.properties.eprint).toBe('1906.01539');
    expect(entry1._biblatex?.properties.eprinttype).toBe('arxiv');

    const entry2 = entries[2]; // aitchison2017you
    expect(entry2._biblatex?.properties.shortjournal).toBe(
      'Current Opinion in Neurobiology',
    );
  });

  test('preserves file field in _biblatex', () => {
    const entries = Array.from(db.entriesRich.values());

    const entry0 = entries[0]; // Weiner2003
    expect(entry0._biblatex?.properties.file).toContain('Weiner');

    const entry2 = entries[2]; // aitchison2017you
    expect(entry2._biblatex?.properties.file).toContain('Aitchison');
  });
});

describe('CslItemRegistry', () => {
  const db = new CitationDatabase(buildFile('bib'));

  beforeEach(async () => {
    await db.deserialize(loadBibLaTeXEntries('library.bib'));
  });

  test('loads and retrieves items', () => {
    const entries = Array.from(db.entries.values());

    expect(db.entries.size).toBe(entries.length);
    expect(db.entries.has('aitchison2017you')).toBe(true);
    expect(db.entries.has('nonexistent')).toBe(false);

    const item = db.retrieve('aitchison2017you');
    expect(item.id).toBe('aitchison2017you');
    expect(item.title).toBeDefined();
  });
});

describe('CiteprocEngine integration', () => {
  const db = new CitationDatabase(buildFile('bib'));

  beforeEach(async () => {
    await db.deserialize(loadBibLaTeXEntries('library.bib'));
  });

  test('renders an APA bibliography', async () => {
    const html = db.renderBibliography(['aitchison2017you'], { style: 'apa' });
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Aitchison');
    expect(html[0]).toContain('Lengyel');
    expect(html[0]).toContain('2017');
  });

  test('renders multiple entries sorted', async () => {
    const html = db.renderBibliography(
      ['aitchison2017you', 'Weiner2003', 'alexandrescu2006factored'],
      { style: 'apa' },
    );
    expect(html).toHaveLength(3);
  });

  test('renders an in-text citation cluster', () => {
    const cluster = db.renderCitationCluster(['aitchison2017you'], {
      style: 'apa',
    });
    expect(cluster).toContain('Aitchison');
    expect(cluster).toContain('2017');
  });

  test('renders with Vancouver style', () => {
    const html = db.renderBibliography(['aitchison2017you'], {
      style: 'vancouver',
    });
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Aitchison');
  });

  test('renders with Harvard style', () => {
    const html = db.renderBibliography(['aitchison2017you'], {
      style: 'harvard1',
    });
    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Aitchison');
  });
});

describe('CiteprocEngine inline citations', () => {
  const db = new CitationDatabase(buildFile('bib'));

  beforeEach(async () => {
    await db.deserialize(loadBibLaTeXEntries('library.bib'));
  });

  test('renders a single inline citation', () => {
    const html = db.renderInlineCitationsBatch([[{ id: 'aitchison2017you' }]], {
      style: 'apa',
    });
    expect(html[0]).toContain('Aitchison');
    expect(html[0]).toContain('2017');
  });

  test('renders multiple citations in one cluster', () => {
    const html = db.renderInlineCitationsBatch(
      [[{ id: 'aitchison2017you' }, { id: 'Weiner2003' }]],
      { style: 'apa' },
    );
    expect(html[0]).toContain('Aitchison');
    expect(html[0]).toContain('Weiner');
  });

  test('renders suppress-author citation', () => {
    const html = db.renderInlineCitationsBatch(
      [[{ id: 'aitchison2017you', 'suppress-author': true }]],
      { style: 'apa' },
    );
    expect(html[0]).toContain('2017');
  });

  test('renders with locator', () => {
    const html = db.renderInlineCitationsBatch(
      [[{ id: 'aitchison2017you', locator: 'p. 220' }]],
      { style: 'apa' },
    );
    expect(html[0]).toContain('220');
  });

  test('returns empty for unknown citekeys', () => {
    const html = db.renderInlineCitationsBatch([[{ id: 'nonexistent' }]], {
      style: 'apa',
    });
    expect(html).toEqual(['']);
  });

  test('Vancouver assigns correct citation numbers in batch', () => {
    const results = db.renderInlineCitationsBatch(
      [
        [{ id: 'aitchison2017you' }],
        [{ id: 'Weiner2003' }],
        [{ id: 'alexandrescu2006factored' }],
      ],
      { style: 'vancouver' },
    );

    expect(results).toHaveLength(3);
    expect(results[0]).toContain('1');
    expect(results[1]).toContain('2');
    expect(results[2]).toContain('3');
  });

  test('Vancouver is stateless across repeated batch renders', () => {
    const first = db.renderInlineCitationsBatch(
      [[{ id: 'aitchison2017you' }], [{ id: 'Weiner2003' }]],
      { style: 'apa' },
    );
    const second = db.renderInlineCitationsBatch(
      [[{ id: 'aitchison2017you' }], [{ id: 'Weiner2003' }]],
      { style: 'apa' },
    );

    expect(first).toEqual(second);
  });

  test('APA inline batch still works (author-date style)', () => {
    const results = db.renderInlineCitationsBatch(
      [[{ id: 'aitchison2017you' }]],
      { style: 'apa' },
    );

    expect(results[0]).toContain('Aitchison');
    expect(results[0]).toContain('2017');
  });
});
