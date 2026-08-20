import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AgentSuggestion } from '@stockpred/shared-types';
import { getEnv } from '@stockpred/shared-utils';
import { repoRoot, taskBriefDir } from './suggestion-store';

const MAX_PROGRESS_LINES = 80;

export function buildImplementPrompt(suggestion: AgentSuggestion): string {
  return [
    `You are implementing a StockPred trader-agent capability gap in this monorepo.`,
    ``,
    `Capability id: ${suggestion.id}`,
    `Title: ${suggestion.title}`,
    `Priority: ${suggestion.priority}`,
    `Suggested owner service/package: ${suggestion.suggestedOwner}`,
    `Why needed: ${suggestion.whyNeeded}`,
    ``,
    `Goals:`,
    `1. Explore the existing codebase (apps/*, packages/*) and reuse patterns — do not invent parallel stacks.`,
    `2. Implement the missing capability end-to-end so trader-agent can probe it as available.`,
    `3. Wire any new HTTP surface through api-gateway if the frontend or agent needs it.`,
    `4. Add or update focused tests where the repo already tests similar code.`,
    `5. Keep changes minimal and match existing style.`,
    ``,
    `Repo context: StockPred monorepo (NestJS services, React frontend, shared-types/utils, auto-trader paper/live).`,
    `Trader-agent probes capabilities in apps/trader-agent and packages/shared-utils/src/trader-agent/.`,
    `Do not invent market data — expose real endpoints/feeds the agent can call.`,
    ``,
    `When done, summarize files changed and how the agent should detect the capability as available.`,
  ].join('\n');
}

export function writeTaskBrief(suggestion: AgentSuggestion): string {
  const dir = taskBriefDir();
  mkdirSync(dir, { recursive: true });
  const relative = join('.cursor', 'agent-tasks', `${suggestion.id}.md`);
  const absolute = join(repoRoot(), relative);
  const progress =
    suggestion.progressLog && suggestion.progressLog.length > 0
      ? ['## Live progress', '', ...suggestion.progressLog.map((line) => `- ${line}`), '']
      : [];
  const body = [
    `# Agent task: ${suggestion.title}`,
    ``,
    `- **id:** \`${suggestion.id}\``,
    `- **owner:** \`${suggestion.suggestedOwner}\``,
    `- **priority:** ${suggestion.priority}`,
    `- **status:** ${suggestion.status}`,
    `- **updated:** ${new Date(suggestion.updatedAt).toISOString()}`,
    suggestion.cursorAgentId ? `- **cursorAgentId:** \`${suggestion.cursorAgentId}\`` : '',
    suggestion.cursorRunId ? `- **cursorRunId:** \`${suggestion.cursorRunId}\`` : '',
    ``,
    `## Why`,
    ``,
    suggestion.whyNeeded,
    ``,
    ...progress,
    `## Implementation prompt`,
    ``,
    '```',
    buildImplementPrompt(suggestion),
    '```',
    ``,
  ]
    .filter((line) => line !== '')
    .join('\n');
  writeFileSync(absolute, body, 'utf8');
  return relative.replace(/\\/g, '/');
}

function formatSdkMessage(event: {
  type: string;
  message?: { content?: Array<{ type: string; text?: string; name?: string }> };
  name?: string;
  status?: string;
  text?: string;
}): string | null {
  const ts = new Date().toLocaleTimeString();
  switch (event.type) {
    case 'assistant': {
      const texts =
        event.message?.content
          ?.filter((block) => block.type === 'text' && block.text)
          .map((block) => block.text!.trim())
          .filter(Boolean) ?? [];
      if (texts.length === 0) return null;
      const joined = texts.join(' ').slice(0, 400);
      return `[${ts}] assistant: ${joined}`;
    }
    case 'tool_call': {
      const name = event.name || 'tool';
      const status = event.status || 'running';
      return `[${ts}] tool ${name} (${status})`;
    }
    case 'thinking': {
      const text = (event.text || '').trim().slice(0, 240);
      return text ? `[${ts}] thinking: ${text}` : null;
    }
    case 'status': {
      return `[${ts}] status: ${event.status || 'unknown'}${event.text ? ` — ${event.text}` : ''}`;
    }
    case 'task': {
      const text = (event.text || event.status || '').trim();
      return text ? `[${ts}] task: ${text}` : null;
    }
    case 'system':
      return `[${ts}] agent initialized`;
    default:
      return null;
  }
}

export type ImplementLaunchResult = {
  mode: 'cursor-sdk' | 'task-brief';
  agentId?: string;
  runId?: string;
  taskBriefPath: string;
  summary: string;
  /** Consumes the run stream and resolves when finished. */
  followProgress?: (onLine: (line: string) => void) => Promise<{
    status: string;
    result?: string;
  }>;
};

/**
 * Launch a Cursor SDK local agent with full repo cwd when CURSOR_API_KEY is set.
 * Always writes a retained task brief under .cursor/agent-tasks/.
 */
export async function launchCapabilityImplement(
  suggestion: AgentSuggestion,
): Promise<ImplementLaunchResult> {
  const taskBriefPath = writeTaskBrief({
    ...suggestion,
    status: 'implementing',
    updatedAt: Date.now(),
    progressLog: suggestion.progressLog ?? [`[${new Date().toLocaleTimeString()}] queued`],
  });
  const apiKey = getEnv('CURSOR_API_KEY', '');
  const cwd = repoRoot();

  if (!apiKey) {
    return {
      mode: 'task-brief',
      taskBriefPath,
      summary:
        'CURSOR_API_KEY not set — wrote a retained task brief. Open it in Cursor Agent to implement with full repo context.',
    };
  }

  try {
    const sdk = await import('@cursor/sdk');
    const Agent = (
      sdk as {
        Agent: {
          create: (opts: unknown) => Promise<{
            agentId: string;
            send: (prompt: string) => Promise<{
              id: string;
              status: string;
              stream: () => AsyncGenerator<unknown, void>;
              wait: () => Promise<{ status: string; result?: string }>;
              onDidChangeStatus?: (listener: (status: string) => void) => () => void;
            }>;
          }>;
        };
      }
    ).Agent;

    const agent = await Agent.create({
      apiKey,
      model: { id: getEnv('CURSOR_AGENT_MODEL', 'composer-2.5') },
      local: { cwd },
    });

    const run = await agent.send(buildImplementPrompt(suggestion));

    return {
      mode: 'cursor-sdk',
      agentId: agent.agentId,
      runId: run.id,
      taskBriefPath,
      summary: `Cursor agent started on ${cwd} with full project workspace.`,
      followProgress: async (onLine) => {
        onLine(`[${new Date().toLocaleTimeString()}] run ${run.id} streaming…`);
        if (typeof run.onDidChangeStatus === 'function') {
          run.onDidChangeStatus((status) => {
            onLine(`[${new Date().toLocaleTimeString()}] run status → ${status}`);
          });
        }
        try {
          for await (const event of run.stream()) {
            const line = formatSdkMessage(event as Parameters<typeof formatSdkMessage>[0]);
            if (line) onLine(line);
          }
        } catch (streamError) {
          onLine(
            `[${new Date().toLocaleTimeString()}] stream error: ${
              streamError instanceof Error ? streamError.message : String(streamError)
            }`,
          );
        }
        const result = await run.wait();
        onLine(`[${new Date().toLocaleTimeString()}] finished (${result.status})`);
        return result;
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      mode: 'task-brief',
      taskBriefPath,
      summary: `Cursor SDK launch failed (${message}). Task brief retained at ${taskBriefPath}.`,
    };
  }
}

export function appendProgressLine(existing: string[] | undefined, line: string): string[] {
  const next = [...(existing ?? []), line];
  if (next.length <= MAX_PROGRESS_LINES) return next;
  return next.slice(next.length - MAX_PROGRESS_LINES);
}

export function cursorSdkConfigured(): boolean {
  return Boolean(getEnv('CURSOR_API_KEY', ''));
}

export function cursorSdkInstalled(): boolean {
  try {
    require.resolve('@cursor/sdk');
    return true;
  } catch {
    return existsSync(join(repoRoot(), 'node_modules', '@cursor', 'sdk', 'package.json'));
  }
}
