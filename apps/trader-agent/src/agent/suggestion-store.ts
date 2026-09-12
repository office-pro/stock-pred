import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { AgentSuggestion, AgentSuggestionStatus } from '@stockpred/shared-types';

interface StoreFile {
  suggestions: AgentSuggestion[];
}

function defaultStorePath(): string {
  const fromEnv = process.env.AGENT_SUGGESTIONS_PATH;
  if (fromEnv) return resolve(fromEnv);
  return resolve(__dirname, '../../data/suggestions.json');
}

/** Durable JSON store so suggestion cards survive trader-agent restarts. */
export class SuggestionStore {
  private readonly path: string;

  constructor(path = defaultStorePath()) {
    this.path = path;
  }

  list(): AgentSuggestion[] {
    return this.read().suggestions;
  }

  get(id: string): AgentSuggestion | undefined {
    return this.list().find((row) => row.id === id);
  }

  upsert(row: AgentSuggestion): AgentSuggestion {
    const store = this.read();
    const idx = store.suggestions.findIndex((item) => item.id === row.id);
    if (idx >= 0) store.suggestions[idx] = row;
    else store.suggestions.unshift(row);
    this.write(store);
    return row;
  }

  patch(
    id: string,
    patch: Partial<AgentSuggestion> & { status?: AgentSuggestionStatus },
  ): AgentSuggestion | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next: AgentSuggestion = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: Date.now(),
    };
    return this.upsert(next);
  }

  private read(): StoreFile {
    try {
      if (!existsSync(this.path)) return { suggestions: [] };
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as StoreFile;
      return { suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [] };
    } catch {
      return { suggestions: [] };
    }
  }

  private write(store: StoreFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(store, null, 2), 'utf8');
  }
}

export function repoRoot(): string {
  const fromEnv = process.env.REPO_ROOT || process.env.STOCKPRED_REPO_ROOT;
  if (fromEnv) return resolve(fromEnv);
  // apps/trader-agent/dist -> repo root
  return resolve(__dirname, '../../../..');
}

export function taskBriefDir(): string {
  return join(repoRoot(), '.cursor', 'agent-tasks');
}
