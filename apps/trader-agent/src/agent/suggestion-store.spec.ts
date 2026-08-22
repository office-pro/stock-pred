import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SuggestionStore } from './suggestion-store';
import type { AgentSuggestion } from '@stockpred/shared-types';

function sample(overrides: Partial<AgentSuggestion> = {}): AgentSuggestion {
  const now = Date.now();
  return {
    id: 'alt-news',
    title: 'News sentiment',
    whyNeeded: 'Missing news panel',
    suggestedOwner: 'market-data',
    priority: 'medium',
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SuggestionStore', () => {
  let dir: string;
  let store: SuggestionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-suggestions-'));
    store = new SuggestionStore(join(dir, 'suggestions.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips upsert and list', () => {
    store.upsert(sample());
    expect(store.list()).toHaveLength(1);
    expect(store.get('alt-news')?.title).toBe('News sentiment');
  });

  it('persists patches across reload', () => {
    store.upsert(sample());
    store.patch('alt-news', {
      status: 'brief_ready',
      taskBriefPath: '.cursor/agent-tasks/alt-news.md',
    });
    const reloaded = new SuggestionStore(join(dir, 'suggestions.json'));
    const row = reloaded.get('alt-news');
    expect(row?.status).toBe('brief_ready');
    expect(row?.taskBriefPath).toContain('alt-news.md');
    const raw = JSON.parse(readFileSync(join(dir, 'suggestions.json'), 'utf8')) as {
      suggestions: AgentSuggestion[];
    };
    expect(raw.suggestions[0].status).toBe('brief_ready');
  });

  it('survives corrupt JSON by returning empty list', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{not-json', 'utf8');
    const broken = new SuggestionStore(path);
    expect(broken.list()).toEqual([]);
  });
});
