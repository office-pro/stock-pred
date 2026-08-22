/**
 * Generate engine stubs that import only real exports from shared-types.
 * Run: node scripts/align-engines.js
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const agentPath = path.join(__dirname, '../packages/shared-types/src/agent.ts');
const tradingPath = path.join(__dirname, '../packages/shared-types/src/trading.ts');
const riskPath = path.join(__dirname, '../packages/shared-utils/src/risk.ts');

function exportedNames(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const stmt of sf.statements) {
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      names.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      names.add(stmt.name.text);
    }
  }
  return names;
}

const agent = exportedNames(agentPath);
const trading = exportedNames(tradingPath);
const risk = exportedNames(riskPath);

console.log(
  'AgentDecisionMode?',
  agent.has('AgentDecisionMode'),
  'AgentDecisionMode?',
  agent.has('AgentDecisionMode'),
);
console.log(
  'TradeEligibility?',
  agent.has('TradeEligibility'),
  'TradeEligibility?',
  agent.has('TradeEligibility'),
);
console.log(
  'DecisionPolicyResult?',
  agent.has('DecisionPolicyResult'),
  'DecisionPolicyResult?',
  agent.has('DecisionPolicyResult'),
);
console.log(
  'PortfolioSnapshot?',
  trading.has('PortfolioSnapshot'),
  'PortfolioSnapshot?',
  trading.has('PortfolioSnapshot'),
);
console.log(
  'DEFAULT_RISK_LIMITS?',
  trading.has('DEFAULT_RISK_LIMITS'),
  'DEFAULT_RISK_LIMITS?',
  trading.has('DEFAULT_RISK_LIMITS'),
);
console.log(
  'positionSize?',
  risk.has('positionSize'),
  'riskRewardRatio?',
  risk.has('riskRewardRatio'),
);

// Extract DecisionReasonCode union members
const agentSrc = fs.readFileSync(agentPath, 'utf8');
const m = agentSrc.match(/export type DecisionReasonCode\s*=([\s\S]*?);/);
const codes = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
console.log('reason codes sample', codes.slice(0, 8), '... total', codes.length);

const limits = [...agentSrc.matchAll(/perTrade\w+|daily\w+|weekly\w+/g)].map((x) => x[0]);
const tradingSrc = fs.readFileSync(tradingPath, 'utf8');
const limitFields = [...tradingSrc.matchAll(/^\s+(\w+):\s*number/gm)].map((x) => x[1]);
console.log(
  'RiskLimits fields',
  limitFields.filter((f) => /Risk|Drawdown|Percent/i.test(f) || true).slice(0, 10),
);
