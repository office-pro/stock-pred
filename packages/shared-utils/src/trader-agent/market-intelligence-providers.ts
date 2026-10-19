/**
 * Provider adapters for Market Intelligence source binding.
 * NSE primary via MDS panels; Screener/TrueData disabled stubs.
 * No trader-agent direct Yahoo/NSE HTTP — panel readers only.
 */

import type {
  CorporateDisclosureProvider,
  FundamentalProvider,
  InstrumentRef,
  MiDateRange,
  NewsProvider,
  RawCorporateDisclosure,
  RawFinancialRecord,
  RawFundamentalRecord,
  RawNewsArticle,
} from '@stockpred/shared-types';
import {
  isScreenerLiveEnabled,
  isTrueDataEnabled,
  resolveMiCorporateProviders,
  resolveMiEnrichmentProviders,
  resolveMiFundamentalProviders,
  resolveMiMacroProvider,
  resolveMiNewsProviders,
} from './mi-source-policy';
import {
  corporateFromMdsPanel,
  rawFundamentalsFromMdsPanel,
  rawNewsFromMdsPanel,
  type NseMdsCorporatePanelRow,
} from './mi-mds-bind';
import type { NseMdsFundamentalsPanelRow, NseMdsNewsPanelRow } from './nse-mds-evidence';

export type MiPanelLookup = {
  fundamentals?: Map<string, NseMdsFundamentalsPanelRow>;
  news?: Map<string, NseMdsNewsPanelRow>;
  corporate?: Map<string, NseMdsCorporatePanelRow[]>;
};

/** NSE fundamentals — reads MDS panel rows when supplied; never invents metrics. */
export function createNseFundamentalProvider(panels?: MiPanelLookup): FundamentalProvider {
  return {
    id: 'nse',
    async getCompanyProfile(instrument: InstrumentRef): Promise<RawFundamentalRecord[]> {
      const row = panels?.fundamentals?.get(instrument.symbol.toUpperCase());
      return rawFundamentalsFromMdsPanel(instrument, row);
    },
    async getFinancialStatements(
      instrument: InstrumentRef,
      _range: MiDateRange,
    ): Promise<RawFinancialRecord[]> {
      const raw = await this.getCompanyProfile!(instrument);
      return raw.map((r) => ({ ...r, statement: 'RATIOS' as const }));
    },
  };
}

/**
 * Yahoo fundamentals adapter retained for tests/compat but is NOT source-of-truth.
 * Historical OHLCV remains on MDS; do not enable in FUNDAMENTAL_PROVIDERS.
 */
export function createYahooFundamentalProvider(): FundamentalProvider {
  return {
    id: 'yahoo',
    async getCompanyProfile(_instrument: InstrumentRef): Promise<RawFundamentalRecord[]> {
      return [];
    },
  };
}

/** Screener enrichment — disabled stub (no scrape / IP bypass). */
export function createScreenerEnrichmentProviderStub(): FundamentalProvider {
  return {
    id: 'screener',
    async getCompanyProfile(): Promise<RawFundamentalRecord[]> {
      if (isScreenerLiveEnabled()) {
        throw new Error('SCREENER_NOT_IMPLEMENTED');
      }
      return [];
    },
  };
}

export function createCurrentNewsProvider(panels?: MiPanelLookup): NewsProvider {
  return {
    id: 'current',
    async searchByInstrument(
      instrument: InstrumentRef,
      _range: MiDateRange,
    ): Promise<RawNewsArticle[]> {
      const row = panels?.news?.get(instrument.symbol.toUpperCase());
      const articles = rawNewsFromMdsPanel(instrument, row);
      return articles.filter((a) => a.provenance.source !== 'gdelt');
    },
  };
}

export function createGdeltNewsProvider(panels?: MiPanelLookup): NewsProvider {
  return {
    id: 'gdelt',
    async searchByInstrument(
      instrument: InstrumentRef,
      _range: MiDateRange,
    ): Promise<RawNewsArticle[]> {
      const row = panels?.news?.get(instrument.symbol.toUpperCase());
      const articles = rawNewsFromMdsPanel(instrument, row);
      return articles.filter(
        (a) =>
          a.provenance.source === 'gdelt' || (row?.source ?? '').toLowerCase().includes('gdelt'),
      );
    },
  };
}

export function createNseCorporateProvider(panels?: MiPanelLookup): CorporateDisclosureProvider {
  return {
    id: 'nse',
    async getAnnouncements(
      instrument: InstrumentRef,
      _range: MiDateRange,
    ): Promise<RawCorporateDisclosure[]> {
      const rows = panels?.corporate?.get(instrument.symbol.toUpperCase());
      return corporateFromMdsPanel(instrument, rows).disclosures;
    },
  };
}

export function createBseCorporateProvider(): CorporateDisclosureProvider {
  return {
    id: 'bse',
    async getAnnouncements(): Promise<RawCorporateDisclosure[]> {
      return [];
    },
  };
}

/** Disabled stub — no network, no API key required. */
export function createTrueDataFundamentalProviderStub(): FundamentalProvider {
  return {
    id: 'truedata',
    async getCompanyProfile(): Promise<RawFundamentalRecord[]> {
      if (isTrueDataEnabled()) {
        throw new Error('TRUEDATA_NOT_IMPLEMENTED');
      }
      return [];
    },
  };
}

export function createTrueDataNewsProviderStub(): NewsProvider {
  return {
    id: 'truedata',
    async searchByInstrument(): Promise<RawNewsArticle[]> {
      if (isTrueDataEnabled()) {
        throw new Error('TRUEDATA_NOT_IMPLEMENTED');
      }
      return [];
    },
  };
}

export function listEnabledMiProviders(): {
  fundamentals: string[];
  enrichment: string[];
  news: string[];
  corporate: string[];
  macro: string;
} {
  return {
    fundamentals: resolveMiFundamentalProviders(),
    enrichment: resolveMiEnrichmentProviders(),
    news: resolveMiNewsProviders(),
    corporate: resolveMiCorporateProviders(),
    macro: resolveMiMacroProvider(),
  };
}
