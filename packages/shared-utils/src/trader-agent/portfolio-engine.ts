import type {
  DecisionReasonCode,
  PortfolioSnapshot,
  PortfolioVerdict,
  RiskVerdict,
  TradeDecision,
} from '@stockpred/shared-types';

export interface PortfolioEngineInput {
  decision: TradeDecision;
  risk: RiskVerdict;
  portfolio: PortfolioSnapshot;
  maxOpenPositions?: number;
  maxNameExposurePct?: number;
  maxSectorExposurePct?: number;
  cashReservePct?: number;
  symbolSector?: string | null;
}

/** Absolute portfolio veto. */
export function evaluatePortfolio(input: PortfolioEngineInput): PortfolioVerdict {
  const {
    decision,
    risk,
    portfolio,
    maxOpenPositions = 20,
    maxNameExposurePct = 10,
    maxSectorExposurePct = 30,
    cashReservePct = 5,
    symbolSector,
  } = input;

  const blockedBy: DecisionReasonCode[] = [];
  const reasons: string[] = [];
  const reasonCodes: DecisionReasonCode[] = [];

  const quantity = risk.allowed ? risk.quantity : decision.setup.recommendedQty;
  const entry = decision.setup.entry ?? 0;
  const requiredCapital = quantity * entry;
  const equity = Math.max(portfolio.equity, portfolio.capital, 1);
  const cash = portfolio.cash;
  const openPositions = portfolio.openPositions;
  const symbol = decision.symbol.toUpperCase();

  if (portfolio.holdings.some((h) => h.symbol.toUpperCase() === symbol)) {
    blockedBy.push('DUPLICATE_POSITION');
    reasons.push(`${symbol} is already held`);
  }

  if (openPositions >= maxOpenPositions) {
    blockedBy.push('MAX_POSITIONS');
    reasons.push(`Open positions ${openPositions} at max ${maxOpenPositions}`);
  }

  const nameExposurePct = entry > 0 ? (requiredCapital / equity) * 100 : 0;
  if (nameExposurePct > maxNameExposurePct) {
    blockedBy.push('MAX_NAME_EXPOSURE');
    reasons.push(`Name exposure ${nameExposurePct.toFixed(1)}% exceeds max ${maxNameExposurePct}%`);
  }

  const reserveFloor = (equity * cashReservePct) / 100;
  if (cash - requiredCapital < reserveFloor) {
    blockedBy.push('CASH_RESERVE_FLOOR');
    reasons.push(
      `Trade would leave cash below ${cashReservePct}% reserve (need ₹${requiredCapital.toFixed(0)})`,
    );
  }

  if (requiredCapital > cash) {
    blockedBy.push('INSUFFICIENT_CASH');
    reasons.push('Insufficient cash for required capital');
  }

  let sectorExposurePct: number | null = null;
  if (symbolSector) {
    const sectorValue = portfolio.holdings
      .filter((h) => {
        const sector = h.sector;
        return sector != null && sector === symbolSector;
      })
      .reduce((sum, h) => sum + h.quantity * h.currentPrice, 0);
    sectorExposurePct = ((sectorValue + requiredCapital) / equity) * 100;
    if (sectorExposurePct > maxSectorExposurePct) {
      blockedBy.push('SECTOR_EXPOSURE_LIMIT');
      reasons.push(
        `Sector ${symbolSector} exposure ${sectorExposurePct.toFixed(1)}% exceeds ${maxSectorExposurePct}%`,
      );
    }
  } else {
    reasonCodes.push('SECTOR_UNKNOWN_SKIPPED');
    reasons.push('Sector unknown — sector concentration check skipped');
  }

  const base = {
    openPositions,
    cash,
    requiredCapital,
    nameExposurePct,
    sectorExposurePct,
  };

  if (blockedBy.length > 0) {
    return {
      allowed: false,
      ...base,
      reasonCodes: [...reasonCodes, ...blockedBy],
      reasons,
      blockedBy,
    };
  }

  return {
    allowed: true,
    ...base,
    reasonCodes,
    reasons:
      reasonCodes.length > 0
        ? reasons
        : [
            `Fits book: ${openPositions + 1}/${maxOpenPositions} positions, name ${nameExposurePct.toFixed(1)}%`,
          ],
  };
}
