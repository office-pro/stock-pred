import { filterGdeltByAliases, titleMatchesAliases, type Headline } from './news-fetch';

describe('GDELT alias entity link', () => {
  it('keeps a headline that names the company and drops unmatched GDELT rows', () => {
    expect(
      titleMatchesAliases('TCS wins a large banking contract', ['TCS', 'TATA CONSULTANCY']),
    ).toBe(true);
    expect(titleMatchesAliases('Infosys guidance cut after miss', ['TCS'])).toBe(false);
    const rows: Headline[] = [
      {
        source: 'gdelt',
        url: 'https://example.com/a',
        title: 'Reliance Industries bags oil contract',
        publishedAt: new Date('2024-01-02T00:00:00Z'),
      },
      {
        source: 'gdelt',
        url: 'https://example.com/b',
        title: 'Unrelated global markets wrap',
        publishedAt: new Date('2024-01-02T00:00:00Z'),
      },
      {
        source: 'google-news',
        url: 'https://example.com/c',
        title: 'Unrelated global markets wrap',
        publishedAt: new Date('2024-01-02T00:00:00Z'),
      },
    ];
    const kept = filterGdeltByAliases(rows, ['RELIANCE', 'RELIANCE INDUSTRIES']);
    expect(kept.map((row) => row.url)).toEqual(['https://example.com/a', 'https://example.com/c']);
  });
});
