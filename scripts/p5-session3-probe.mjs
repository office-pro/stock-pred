#!/usr/bin/env node
/**
 * P5 Session 3 ops probe — login, opportunities, quote freshness, Focus Universe.
 * Uses seeded demo credentials from packages/database/src/demo-users.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const GATEWAY = `http://localhost:${env.API_GATEWAY_PORT || 3000}`;
const MDS = env.MARKET_DATA_SERVICE_URL || 'http://localhost:3002';
const AGENT = `http://localhost:${env.TRADER_AGENT_PORT || 3008}`;
const FOCUS_LATEST = resolve(ROOT, 'apps/trader-agent/data/focus-universe-latest.json');

const DEMO_EMAIL = 'user@stockpred.local';
const DEMO_PASSWORD = 'User@12345';

async function j(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  await j(`${MDS}/stocks/RELIANCE`, { timeoutMs: 30_000 });
  const contract = await j(`${MDS}/market/data-contract`, { timeoutMs: 10_000 });

  const login = await j(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    timeoutMs: 30_000,
  });

  if (login.status !== 200 && login.status !== 201) {
    console.log(JSON.stringify({ phase: 'login', status: login.status, body: login.body }, null, 2));
    process.exit(1);
  }

  const token = login.body.tokens?.accessToken ?? login.body.accessToken;
  const userId = login.body.user?.id;
  const brandId = login.body.user?.brandId;
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-user-id': userId,
    ...(brandId ? { 'x-brand-id': brandId } : {}),
  };

  const agentHeaders = {
    'x-user-id': userId,
    ...(brandId ? { 'x-brand-id': brandId } : {}),
  };

  const mode = await j(`${GATEWAY}/api/agent/mode`, { headers, timeoutMs: 15_000 });
  const focusBefore = await j(`${AGENT}/agent/focus-universe/latest`, {
    headers: agentHeaders,
    timeoutMs: 15_000,
  });
  const offline = await j(`${AGENT}/agent/focus-universe/run-offline?limit=40`, {
    method: 'POST',
    headers: agentHeaders,
    timeoutMs: 300_000,
  });
  const focusAfter = await j(`${AGENT}/agent/focus-universe/latest`, {
    headers: agentHeaders,
    timeoutMs: 15_000,
  });

  const oppsGw = await j(`${GATEWAY}/api/agent/opportunities?limit=5`, {
    headers,
    timeoutMs: 180_000,
  });
  const oppsDirect = await j(`${AGENT}/agent/opportunities?limit=5`, {
    headers: agentHeaders,
    timeoutMs: 180_000,
  });

  const qs = contract.body?.quoteStatus;
  const freshnessOk =
    qs === 'LIVE' ||
    qs === 'DELAYED' ||
    qs === 'CLOSED_MARKET' ||
    qs === 'STALE' ||
    qs === 'UNKNOWN';

  console.log(
    JSON.stringify(
      {
        quoteContract: contract.body,
        freshnessTaxonomyRecognized: freshnessOk,
        login: { status: login.status, userId, brandId: brandId ?? null },
        mode: { status: mode.status, body: mode.body },
        focusUniverse: {
          diskArtifactExists: existsSync(FOCUS_LATEST),
          before: {
            status: focusBefore.status,
            batchId: focusBefore.body?.batchId ?? null,
          },
          offlineRun: {
            status: offline.status,
            batchId: offline.body?.batchId ?? null,
            universeSize: offline.body?.universeSize ?? null,
            candidateCount: offline.body?.candidates?.length ?? null,
            tierBoundaries: offline.body?.tierBoundaries ?? null,
          },
          after: {
            status: focusAfter.status,
            batchId: focusAfter.body?.batchId ?? null,
          },
        },
        opportunitiesGateway: {
          status: oppsGw.status,
          count: oppsGw.body?.opportunities?.length ?? null,
          focusBatchId: oppsGw.body?.focusBatchId ?? null,
          provenanceSample: Object.entries(oppsGw.body?.opportunityProvenanceById ?? {})
            .slice(0, 2)
            .map(([id, p]) => ({
              id,
              discoverySource: p.discoverySource,
              dataStatus: p.dataProvenance?.dataStatus,
              liveReady: p.liveReady,
              focusTier: p.focusTier,
            })),
          sample: oppsGw.body?.opportunities?.slice(0, 2)?.map((o) => ({
            symbol: o.symbol,
            decision: o.decision,
            recommendationId: o.recommendationId,
          })),
        },
        opportunitiesDirect: {
          status: oppsDirect.status,
          count: oppsDirect.body?.opportunities?.length ?? null,
        },
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
