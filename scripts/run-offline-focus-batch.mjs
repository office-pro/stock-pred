#!/usr/bin/env node
/**
 * Ops helper: build FocusUniverseBatch from MDS EOD/cached /stocks (read-only).
 * Does not call Risk/Policy/Gate or write the decision ledger.
 *
 * Prefer POST /agent/focus-universe/run-offline when trader-agent is rebuilt.
 * This script fills the artifact when the new agent image is not yet deployed.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MDS = process.env.MARKET_DATA_SERVICE_URL || 'http://localhost:3002';
const DATA = resolve(ROOT, 'apps/trader-agent/data');
const TIER1 = 15;
const TIER2 = 35;

function focusTierFromRank(rank) {
  if (rank <= TIER1) return 1;
  if (rank <= TIER1 + TIER2) return 2;
  return 3;
}

async function main() {
  const limit = Number(process.env.FOCUS_LIMIT || 80);
  const res = await fetch(`${MDS}/stocks?page=1&limit=${limit}&sort=symbol`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`MDS /stocks HTTP ${res.status}`);
  const body = await res.json();
  const quotes = body.data ?? [];
  const generatedAt = Date.now();
  const dataAsOf = quotes.reduce((m, q) => Math.max(m, q.updatedAt || 0), 0);

  // Deterministic order: symbol sort (stable). Full agent path uses RankingContext lex order.
  const ranked = [...quotes].sort((a, b) =>
    String(a.symbol).localeCompare(String(b.symbol)),
  );

  const candidates = ranked.map((q, i) => {
    const rank = i + 1;
    return {
      symbol: String(q.symbol).toUpperCase(),
      focusTier: focusTierFromRank(rank),
      rank,
      intelligenceContext: {
        decision: q.suggestion ?? undefined,
        overallScore: q.confidence ?? undefined,
      },
      provenance: {
        dataAsOf: q.updatedAt || dataAsOf || generatedAt,
        receivedAt: generatedAt,
        analysisAt: generatedAt,
        dataAgeMs: q.updatedAt ? Math.max(0, generatedAt - q.updatedAt) : -1,
        dataStatus: 'CLOSED_MARKET',
      },
    };
  });

  const batch = {
    schemaVersion: 'focus-universe.v1',
    batchId: `FOCUS-OPS-${generatedAt}`,
    generatedAt,
    dataAsOf: dataAsOf || generatedAt,
    source: 'EOD_CACHED',
    dataStatus: 'CLOSED_MARKET',
    universeSize: candidates.length,
    tierBoundaries: {
      tier1Count: TIER1,
      tier2Count: TIER2,
      note: `T1=ranks 1..${TIER1}; T2=ranks ${TIER1 + 1}..${TIER1 + TIER2}; T3=rest. Deterministic order only — no RankingScore. Ops script fallback (symbol sort); prefer agent RankingContext batch when available.`,
    },
    candidates,
  };

  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  const latest = resolve(DATA, 'focus-universe-latest.json');
  const dated = resolve(
    DATA,
    `focus-universe-${new Date(generatedAt + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10)}.json`,
  );
  const text = `${JSON.stringify(batch, null, 2)}\n`;
  writeFileSync(latest, text);
  writeFileSync(dated, text);
  console.log(
    JSON.stringify(
      {
        batchId: batch.batchId,
        universeSize: batch.universeSize,
        tier1: candidates.filter((c) => c.focusTier === 1).length,
        tier2: candidates.filter((c) => c.focusTier === 2).length,
        tier3: candidates.filter((c) => c.focusTier === 3).length,
        latest,
        note: 'Read-only artifact. Not authorization. Rebuild trader-agent for RankingContext offline path.',
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
