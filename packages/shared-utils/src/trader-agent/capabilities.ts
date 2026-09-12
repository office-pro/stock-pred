import type {
  AgentCapabilityDef,
  AgentCapabilityOwner,
  AgentCapabilityPriority,
  AgentCapabilityRequest,
  AgentCapabilityStatus,
  AgentDecision,
} from '@stockpred/shared-types';

/** Capabilities the agent expects from the existing app stack. */
export const AGENT_CAPABILITY_DEFS: AgentCapabilityDef[] = [
  {
    id: 'quotes',
    title: 'Live quotes / last price',
    required: true,
    owner: 'market-data',
    description: 'Stock price for entry sizing and mark-to-market',
  },
  {
    id: 'signals',
    title: 'Trading signals',
    required: true,
    owner: 'signal-engine',
    description: 'Rule-based BUY/SELL with confidence and levels',
  },
  {
    id: 'patterns',
    title: 'Chart patterns',
    required: false,
    owner: 'pattern-engine',
    description: 'Historic pattern matches for setup quality',
  },
  {
    id: 'predictions',
    title: 'ML direction predictions',
    required: false,
    owner: 'ml-engine',
    description: 'NEXT_DAY / NEXT_WEEK UP/DOWN/SIDEWAYS',
  },
  {
    id: 'fundamentals',
    title: 'Fundamentals / FA score',
    required: false,
    owner: 'market-data',
    description: 'PE/PB/ROE and display score from fundamental snapshots',
  },
  {
    id: 'alt-news',
    title: 'News sentiment',
    required: false,
    owner: 'market-data',
    description: '7d news sentiment and article counts',
  },
  {
    id: 'alt-social',
    title: 'Social sentiment',
    required: false,
    owner: 'market-data',
    description: 'Mentions and fear/greed style social tone',
  },
  {
    id: 'alt-macro',
    title: 'Macro features',
    required: false,
    owner: 'market-data',
    description: 'USDINR, Brent, repo, CPI snapshots',
  },
  {
    id: 'scanner',
    title: 'Bull-run / overextension scanner',
    required: false,
    owner: 'market-data',
    description: 'Bull score, risk band, forecast contributors',
  },
  {
    id: 'manipulation',
    title: 'Unusual activity band',
    required: false,
    owner: 'market-data',
    description: 'NORMAL / SUSPICIOUS / INVESTIGATE intensity',
  },
  {
    id: 'portfolio',
    title: 'Portfolio & open holdings',
    required: true,
    owner: 'auto-trader',
    description: 'Cash, lots, targets, stops for risk and monitoring',
  },
  {
    id: 'broker-orders',
    title: 'Broker place/cancel parity',
    required: true,
    owner: 'broker-sdk',
    description: 'BUY and SELL through BrokerRouter for paper and live',
  },
  {
    id: 'intraday-mtf',
    title: 'Multi-timeframe intraday candles',
    required: false,
    owner: 'market-data',
    description: '5m/15m/1h series for short-horizon setups',
  },
  {
    id: 'peer-valuation',
    title: 'Peer / sector valuation medians',
    required: false,
    owner: 'market-data',
    description: 'Compare PE/PB to sector peers',
  },
];

export interface CapabilityProbeResult {
  id: string;
  available: boolean;
  stale?: boolean;
  detail?: string;
}

export function buildCapabilityStatuses(probes: CapabilityProbeResult[]): AgentCapabilityStatus[] {
  const byId = new Map(probes.map((row) => [row.id, row]));
  return AGENT_CAPABILITY_DEFS.map((def) => {
    const probe = byId.get(def.id);
    return {
      ...def,
      available: Boolean(probe?.available),
      stale: Boolean(probe?.stale),
      detail: probe?.detail,
    };
  });
}

export function capabilityRequestsFromStatuses(
  statuses: AgentCapabilityStatus[],
  now = Date.now(),
): AgentCapabilityRequest[] {
  const requests: AgentCapabilityRequest[] = [];
  for (const status of statuses) {
    if (status.available && !status.stale) continue;
    const priority: AgentCapabilityPriority = status.required
      ? status.available
        ? 'high'
        : 'blocker'
      : 'medium';
    const blockedDecisions: AgentDecision[] = status.required
      ? ['STRONG_BUY', 'BUY', 'BUY_ON_BREAKOUT', 'BUY_ON_PULLBACK']
      : ['STRONG_BUY'];
    requests.push({
      id: status.id,
      title: status.title,
      whyNeeded: status.stale
        ? `${status.title} is stale${status.detail ? `: ${status.detail}` : ''}. Agent will not invent values.`
        : `${status.title} is not available. Ask ${status.owner} to expose it.`,
      blockedDecisions,
      suggestedOwner: status.owner as AgentCapabilityOwner,
      priority,
      createdAt: now,
    });
  }
  return requests;
}

export function requiredCapabilitiesMissing(statuses: AgentCapabilityStatus[]): boolean {
  return statuses.some((row) => row.required && (!row.available || row.stale));
}
