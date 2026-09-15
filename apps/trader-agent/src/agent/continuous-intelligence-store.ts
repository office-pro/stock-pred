/**
 * B7 continuous intelligence — process-local event log + dedupe.
 * Advisory reassessment only; never amends orders.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  ContinuousIntelligenceEvent,
  ContinuousReassessmentResult,
  PositionManagementPlan,
} from '@stockpred/shared-types';
import {
  ContinuousEventDedupeStore,
  buildContinuousEvent,
  reassessContinuousEvent,
} from '@stockpred/shared-utils';

const DATA_DIR = join(process.cwd(), 'data', 'continuous-intelligence');
const EVENTS_FILE = join(DATA_DIR, 'events.json');
const PLANS_FILE = join(DATA_DIR, 'position-plans.json');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  ensureDir();
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

export class ContinuousIntelligenceStore {
  private readonly dedupe = new ContinuousEventDedupeStore();
  private events: ContinuousIntelligenceEvent[] = [];
  private plans: PositionManagementPlan[] = [];

  constructor() {
    this.events = readJson(EVENTS_FILE, []);
    this.plans = readJson(PLANS_FILE, []);
    for (const e of this.events) {
      this.dedupe.claim(e.dedupeKey, e.occurredAt);
    }
  }

  listEvents(limit = 50): ContinuousIntelligenceEvent[] {
    return this.events.slice(-limit).reverse();
  }

  listPlans(limit = 50): PositionManagementPlan[] {
    return this.plans.slice(-limit).reverse();
  }

  ingest(input: {
    eventId: string;
    symbol: string;
    priority: ContinuousIntelligenceEvent['priority'];
    trigger: ContinuousIntelligenceEvent['trigger'];
    dataStatus: ContinuousIntelligenceEvent['dataStatus'];
    message: string;
    position?: {
      positionId: string;
      originalEntry: number;
      currentPrice: number;
      originalTarget?: number;
      originalStop?: number;
      thesisState?: string;
      cutoffReached?: boolean;
      tradeId?: string;
      decisionId?: string;
    };
  }): ContinuousReassessmentResult {
    const event = buildContinuousEvent({
      eventId: input.eventId,
      symbol: input.symbol,
      priority: input.priority,
      trigger: input.trigger,
      dataStatus: input.dataStatus,
      message: input.message,
      positionId: input.position?.positionId,
      decisionId: input.position?.decisionId,
      tradeId: input.position?.tradeId,
    });

    const result = reassessContinuousEvent({
      event,
      dedupe: this.dedupe,
      position: input.position,
    });

    if (!result.deduplicated) {
      this.events.push(event);
      if (this.events.length > 500) this.events = this.events.slice(-500);
      writeJson(EVENTS_FILE, this.events);
      if (result.positionPlan) {
        this.plans.push(result.positionPlan);
        if (this.plans.length > 200) this.plans = this.plans.slice(-200);
        writeJson(PLANS_FILE, this.plans);
      }
    }

    return result;
  }
}
