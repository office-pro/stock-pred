const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const POS = [
  'beat',
  'beats',
  'surge',
  'rally',
  'profit',
  'growth',
  'expand',
  'expansion',
  'win',
  'wins',
  'contract',
  'order',
  'upgrade',
  'buyback',
  'dividend',
  'strong',
  'bullish',
  'launch',
  'approved',
];
const NEG = [
  'miss',
  'misses',
  'plunge',
  'slump',
  'loss',
  'fraud',
  'probe',
  'downgrade',
  'layoff',
  'strike',
  'debt',
  'default',
  'ban',
  'penalty',
  'lawsuit',
  'weak',
  'bearish',
  'scam',
];

const EVENTS: Array<{ type: string; pattern: RegExp; strength: number }> = [
  { type: 'EARNINGS_BEAT', pattern: /\b(beats?|beat estimates|above estimate)\b/i, strength: 0.85 },
  {
    type: 'EARNINGS_MISS',
    pattern: /\b(misses?|below estimate|short of estimate)\b/i,
    strength: 0.85,
  },
  {
    type: 'REVENUE_GROWTH',
    pattern: /\b(revenue (up|growth|rose)|sales (up|growth))\b/i,
    strength: 0.7,
  },
  {
    type: 'PROFIT_GROWTH',
    pattern: /\b(profit (up|growth|rose)|pat (up|growth)|net profit)\b/i,
    strength: 0.7,
  },
  {
    type: 'NEW_CONTRACT',
    pattern: /\b(contract|order (win|won|bag)|bags? order)\b/i,
    strength: 0.8,
  },
  { type: 'ORDER_WIN', pattern: /\b(order win|won (an )?order|secures? order)\b/i, strength: 0.8 },
  { type: 'PRODUCT_LAUNCH', pattern: /\b(launch(es|ed)?|unveils?|introduces?)\b/i, strength: 0.65 },
  { type: 'CAPEX', pattern: /\b(capex|capacity expansion|invests? rs)\b/i, strength: 0.7 },
  { type: 'ACQUISITION', pattern: /\b(acqui(re|res|red|sition)|buys? stake)\b/i, strength: 0.75 },
  { type: 'MERGER', pattern: /\b(merger|amalgamat)\b/i, strength: 0.75 },
  { type: 'DEBT', pattern: /\b(debt|bond issue|ncd)\b/i, strength: 0.6 },
  { type: 'REGULATORY_ACTION', pattern: /\b(sebi|rbi|nclt|penalty|banned)\b/i, strength: 0.8 },
  {
    type: 'MANAGEMENT_CHANGE',
    pattern: /\b(ceo|cfo|md resign|appoints? (ceo|cfo|md))\b/i,
    strength: 0.65,
  },
  { type: 'FRAUD', pattern: /\b(fraud|scam|forensic)\b/i, strength: 0.95 },
  { type: 'LEGAL_ISSUE', pattern: /\b(lawsuit|litigation|court|ed raid)\b/i, strength: 0.8 },
  { type: 'STRIKE', pattern: /\b(strike|lockout)\b/i, strength: 0.7 },
  { type: 'LAYOFF', pattern: /\b(layoff|laid off|job cut)\b/i, strength: 0.75 },
  { type: 'DIVIDEND', pattern: /\b(dividend)\b/i, strength: 0.7 },
  { type: 'BUYBACK', pattern: /\b(buyback|share repurchase)\b/i, strength: 0.75 },
  {
    type: 'PROMOTER_SELLING',
    pattern: /\b(promoter (sell|sold|stake sale)|pledged)\b/i,
    strength: 0.8,
  },
  { type: 'PROMOTER_BUYING', pattern: /\b(promoter (buy|bought|raises stake))\b/i, strength: 0.75 },
];

export const EARNINGS_EVENTS = new Set([
  'EARNINGS_BEAT',
  'EARNINGS_MISS',
  'REVENUE_GROWTH',
  'PROFIT_GROWTH',
  'DIVIDEND',
]);

export interface HeadlineScore {
  sentiment: number;
  pos: number;
  neg: number;
  neu: number;
  eventType: string;
  eventStrength: number;
  confidence: number;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).filter(Boolean);
}

export function scoreHeadline(text: string): HeadlineScore {
  const words = tokens(text);
  let posHits = 0;
  let negHits = 0;
  for (const word of words) {
    if (POS.includes(word)) posHits += 1;
    if (NEG.includes(word)) negHits += 1;
  }
  const tagged = posHits + negHits;
  const pos = tagged ? posHits / tagged : 0;
  const neg = tagged ? negHits / tagged : 0;
  const neu = tagged ? Math.max(0, 1 - pos - neg) : 1;
  let sentiment = tagged ? ((posHits - negHits) / Math.max(words.length, 1)) * 8 : 0;
  sentiment = Math.max(-1, Math.min(1, sentiment));
  let eventType = 'OTHER';
  let eventStrength = 0.2;
  for (const event of EVENTS) {
    if (event.pattern.test(text)) {
      eventType = event.type;
      eventStrength = event.strength;
      break;
    }
  }
  return {
    sentiment,
    pos,
    neg,
    neu,
    eventType,
    eventStrength,
    confidence: eventType === 'OTHER' ? 0.4 : 0.7,
  };
}

export { USER_AGENT };
