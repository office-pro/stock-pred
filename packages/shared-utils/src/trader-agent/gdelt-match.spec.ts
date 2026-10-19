import {
  filterGdeltByAliases,
  titleMatchesAliases,
  parseGdeltArticles,
  type GdeltHeadline,
} from './gdelt-match';

describe('GDELT alias entity link', () => {
  it('keeps a headline that names the company and drops unmatched GDELT rows', () => {
    expect(titleMatchesAliases('Apple reports record iPhone sales', ['AAPL', 'APPLE'])).toBe(true);
    expect(titleMatchesAliases('Unrelated global markets wrap', ['AAPL'])).toBe(false);
    const rows: GdeltHeadline[] = [
      { source: 'gdelt', url: 'https://example.com/a', title: 'Apple Inc guidance raised' },
      { source: 'gdelt', url: 'https://example.com/b', title: 'Unrelated global markets wrap' },
    ];
    const kept = filterGdeltByAliases(rows, ['AAPL', 'APPLE']);
    expect(kept.map((row) => row.url)).toEqual(['https://example.com/a']);
  });

  it('drops all GDELT rows when aliases are empty — never guesses a symbol', () => {
    const rows: GdeltHeadline[] = [{ source: 'gdelt', title: 'Apple Inc guidance raised' }];
    expect(filterGdeltByAliases(rows, [])).toEqual([]);
  });

  it('parses ArtList JSON and ignores non-object payloads', () => {
    expect(parseGdeltArticles('not-json')).toEqual([]);
    const parsed = parseGdeltArticles({
      articles: [{ title: 'Apple beats', url: 'https://ex', seendate: '20240102T120000Z' }],
    });
    expect(parsed[0]?.title).toBe('Apple beats');
    expect(parsed[0]?.source).toBe('gdelt');
  });
});
