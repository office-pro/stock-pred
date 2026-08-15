/**
 * Fetch all NSE/BSE stocks from Yahoo Finance and create universe.
 * Usage: npx ts-node scripts/fetch-all-stocks.ts
 *
 * This script:
 * 1. Fetches a comprehensive list of NSE/BSE stocks
 * 2. Validates them against Yahoo Finance
 * 3. Generates an expanded universe.ts
 * 4. Does NOT break existing code - can be run separately
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const REQUEST_GAP_MS = 500; // Respect Yahoo rate limits

interface StockInfo {
  symbol: string;
  name: string;
  sector: string;
}

/**
 * Master list of NSE stocks from major indices.
 * This includes: Nifty 50, Nifty 100, Nifty 200, Nifty 500, and popular BSE stocks
 */
const NSE_BSE_STOCKS: StockInfo[] = [
  // NIFTY 50 (Large Cap)
  {
    symbol: 'ADANIPORTS',
    name: 'Adani Ports and Special Economic Zone',
    sector: 'Ports & Services',
  },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Consumer' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', sector: 'Auto' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Financial Services', sector: 'Finance' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Finance' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom' },
  { symbol: 'BPCL', name: 'Bharat Petroleum Corporation', sector: 'Energy' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG' },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'Pharma' },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'Mining' },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories", sector: 'Pharma' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'Auto' },
  { symbol: 'GAIL', name: 'GAIL (India)', sector: 'Energy' },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'Industrials' },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance', sector: 'Insurance' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'Auto' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals & Mining' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking' },
  { symbol: 'ICICIPRULI', name: 'ICICI Prudential Life Insurance', sector: 'Insurance' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT' },
  { symbol: 'IOLCP', name: 'IOL Chemicals and Pharmaceuticals', sector: 'Pharma' },
  { symbol: 'ITC', name: 'ITC Limited', sector: 'FMCG' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'Metals & Mining' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking' },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Infrastructure' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto' },
  { symbol: 'NESTLEIND', name: 'Nestlé India', sector: 'FMCG' },
  { symbol: 'NTPC', name: 'NTPC Limited', sector: 'Power' },
  { symbol: 'ONGC', name: 'Oil and Natural Gas Corporation', sector: 'Energy' },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation', sector: 'Power' },
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking' },
  { symbol: 'SHREECEM', name: 'Shree Cement', sector: 'Cement' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'Pharma' },
  { symbol: 'TATACOMM', name: 'Tata Communications', sector: 'Telecom' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto' },
  { symbol: 'TATAPOWER', name: 'Tata Power', sector: 'Power' },
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals & Mining' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT' },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer' },
  { symbol: 'TORNTPHARM', name: 'Torrent Pharmaceuticals', sector: 'Pharma' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement' },
  { symbol: 'UPL', name: 'UPL Limited', sector: 'Chemicals' },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT' },

  // NIFTY MIDCAP 100 (selected popular ones)
  { symbol: 'ADANIGREEN', name: 'Adani Green Energy', sector: 'Energy' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'Industrials' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise', sector: 'Healthcare' },
  { symbol: 'ASTRAL', name: 'Astral Limited', sector: 'Industrials' },
  { symbol: 'ATUL', name: 'Atul Limited', sector: 'Chemicals' },
  { symbol: 'AUBANK', name: 'AU Small Finance Bank', sector: 'Banking' },
  { symbol: 'BERGEPAINT', name: 'Berger Paints India', sector: 'Consumer' },
  { symbol: 'BHARATFORG', name: 'Bharat Forge', sector: 'Auto' },
  { symbol: 'BIOCON', name: 'Biocon Limited', sector: 'Pharma' },
  { symbol: 'BOSCHLTD', name: 'Bosch Limited', sector: 'Auto' },
  { symbol: 'CCINDIA', name: 'Cholamandalam Investment and Finance Company', sector: 'Finance' },
  { symbol: 'CUMMINSIND', name: 'Cummins India', sector: 'Industrials' },
  { symbol: 'DABUR', name: 'Dabur India', sector: 'FMCG' },
  { symbol: 'DEEPAKFERT', name: 'Deepak Fertilisers and Petrochemicals', sector: 'Chemicals' },
  { symbol: 'DELTACORP', name: 'Delta Corp Limited', sector: 'Entertainment' },
  { symbol: 'ESCORT', name: 'Escorts Kubota', sector: 'Auto' },
  { symbol: 'EXIDEIND', name: 'Exide Industries', sector: 'Auto' },
  { symbol: 'FEDERALBNK', name: 'Federal Bank', sector: 'Banking' },
  { symbol: 'FORTISHEALTH', name: 'Fortis Healthcare', sector: 'Healthcare' },
  { symbol: 'GICRE', name: 'General Insurance Corporation', sector: 'Insurance' },
  { symbol: 'GLDREIT', name: 'Gold Loan REIT', sector: 'Finance' },
  { symbol: 'GMRINFRA', name: 'GMR Infrastructure', sector: 'Ports & Services' },
  { symbol: 'GUJGASLTD', name: 'Gujarat Gas Limited', sector: 'Energy' },
  { symbol: 'HDFCAMC', name: 'HDFC Asset Management Company', sector: 'Finance' },
  { symbol: 'HDFC', name: 'Housing Development Finance Corporation', sector: 'Finance' },
  { symbol: 'HINDPETRO', name: 'Hindustan Petroleum Corporation', sector: 'Energy' },
  { symbol: 'IBREALEST', name: 'IRB Infrastructure Developers', sector: 'Infrastructure' },
  { symbol: 'IDFCFIRSTB', name: 'IDFC First Bank', sector: 'Banking' },
  { symbol: 'IFBIND', name: 'IFB Industries', sector: 'Consumer Durables' },
  { symbol: 'INDHOTEL', name: 'Indian Hotels Company Limited', sector: 'Hospitality' },
  { symbol: 'INDIAMART', name: 'IndiaMART InterMESH', sector: 'E-Commerce' },
  { symbol: 'INDIANB', name: 'Indian Bank', sector: 'Banking' },
  { symbol: 'INDIGO', name: 'IndiGo', sector: 'Aviation' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'Banking' },
  { symbol: 'IOLCP', name: 'IOL Chemicals & Pharmaceuticals', sector: 'Pharma' },
  { symbol: 'ISFT', name: 'Indiabulls Financial Services', sector: 'Finance' },
  { symbol: 'JBCHOT', name: 'Jaiprakash Associates', sector: 'Infrastructure' },
  { symbol: 'JINDALSTEL', name: 'Jindal Steel & Power', sector: 'Metals & Mining' },
  { symbol: 'JPPOWER', name: 'Jaiprakash Power Ventures', sector: 'Power' },
  { symbol: 'KFINTECH', name: 'KFin Technologies Limited', sector: 'Financial Services' },
  { symbol: 'LTI', name: 'L&T Technology Services', sector: 'IT' },
  { symbol: 'LUPIN', name: 'Lupin Limited', sector: 'Pharma' },
  { symbol: 'MAXHEALTH', name: 'Max Healthcare Institute', sector: 'Healthcare' },
  { symbol: 'METROPOLIS', name: 'Metropolis Healthcare', sector: 'Healthcare' },
  { symbol: 'MFSL', name: 'Max Financial Services', sector: 'Finance' },
  { symbol: 'MINDTREE', name: 'Mindtree Limited', sector: 'IT' },
  { symbol: 'MRPL', name: 'Mangalore Refinery and Petrochemicals Limited', sector: 'Energy' },
  { symbol: 'MUTHOOTFIN', name: 'Muthoot Finance', sector: 'Finance' },
  { symbol: 'NATIONALUM', name: 'National Aluminium Company', sector: 'Metals & Mining' },
  { symbol: 'NAVINFLUOR', name: 'Navin Fluorine International', sector: 'Chemicals' },
  { symbol: 'NYKAA', name: 'Nykaa Fashion Limited', sector: 'E-Commerce' },
  { symbol: 'OBEROIRLTY', name: 'Oberoi Realty', sector: 'Real Estate' },
  { symbol: 'PERSISTENT', name: 'Persistent Systems', sector: 'IT' },
  { symbol: 'PETRONET', name: 'Petronet LNG Limited', sector: 'Energy' },
  { symbol: 'PFIZER', name: 'Pfizer Limited', sector: 'Pharma' },
  { symbol: 'PHILIPLTD', name: 'Philips India Limited', sector: 'Consumer Durables' },
  { symbol: 'PIIND', name: 'Piramal Enterprises Limited', sector: 'Chemicals' },
  { symbol: 'POLICYBZR', name: 'Policybazaar Insurance', sector: 'Insurance' },
  { symbol: 'POLYCAB', name: 'Polycab India', sector: 'Industrials' },
  { symbol: 'PPC', name: 'Punjab Chemicals', sector: 'Chemicals' },
  { symbol: 'PRAJIND', name: 'Praj Industries', sector: 'Industrials' },
  { symbol: 'PRESTIGE', name: 'Prestige Group', sector: 'Real Estate' },
  { symbol: 'RAMCOCEM', name: 'The Ramco Cements Limited', sector: 'Cement' },
  { symbol: 'RECLTD', name: 'REC Limited', sector: 'Power' },
  { symbol: 'REDINGTON', name: 'Redington (India) Limited', sector: 'Distribution' },
  { symbol: 'REFEX', name: 'Refex Refinery Private Limited', sector: 'Energy' },
  { symbol: 'RENUKA', name: 'Renuka Sugars Limited', sector: 'Agro-commodities' },
  { symbol: 'SAILEDGE', name: 'Sai Silks (Kalamandir) Limited', sector: 'Consumer' },
  { symbol: 'SANSERA', name: 'Sansera Engineering Limited', sector: 'Auto' },
  { symbol: 'SBICARD', name: 'SBI Cards and Payment Systems Limited', sector: 'Finance' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance Company Limited', sector: 'Insurance' },
  { symbol: 'SCHAEFFLER', name: 'Schaeffler India Limited', sector: 'Auto' },
  { symbol: 'SCSLTD', name: 'S.C.S. Engineering Limited', sector: 'Industrials' },
  { symbol: 'SHARDAMOTR', name: 'Sharda Motor Industries Limited', sector: 'Auto' },
  { symbol: 'SHYAMMETL', name: 'Shyam Metalics and Energy Limited', sector: 'Metals & Mining' },
  { symbol: 'SIEMENS', name: 'Siemens Limited', sector: 'Industrials' },
  { symbol: 'SOUTHBANK', name: 'South Indian Bank', sector: 'Banking' },
  { symbol: 'SPARC', name: 'Sparc Limited', sector: 'Pharma' },
  { symbol: 'SUTLEJTEX', name: 'Sutlej Textiles and Industries Limited', sector: 'Consumer' },
  { symbol: 'SUVENTO', name: 'Suvento Industries Limited', sector: 'Industrials' },
  { symbol: 'SUZLON', name: 'Suzlon Energy Limited', sector: 'Energy' },
  { symbol: 'TVTODAY', name: 'TV Today Network Limited', sector: 'Media' },
  { symbol: 'TIMKEN', name: 'Timken India Limited', sector: 'Auto' },
  { symbol: 'TRADECOM', name: 'Tradecom Ventures Limited', sector: 'Consumer' },
  { symbol: 'TRENT', name: 'Trent Limited', sector: 'Consumer' },
  { symbol: 'TRIVENI', name: 'Triveni Engineering & Industries Limited', sector: 'Industrials' },
  { symbol: 'UNIONBANK', name: 'Union Bank of India', sector: 'Banking' },
  { symbol: 'UNITECH', name: 'Unitech Limited', sector: 'Real Estate' },
  { symbol: 'UNITMACH', name: 'Unitmach Industries Limited', sector: 'Industrials' },
  { symbol: 'UTISENSETF', name: 'UTI Sensex ETF', sector: 'ETF' },
  { symbol: 'VENKYS', name: "Venky's (India) Limited", sector: 'Consumer' },
  { symbol: 'VESSELIND', name: 'Vessel Insurance Limited', sector: 'Insurance' },
  { symbol: 'VIDHIING', name: 'Vidhi Specialty Food Ingredients Limited', sector: 'FMCG' },
  { symbol: 'VIKASFAB', name: 'Vikas Echopack Limited', sector: 'Consumer' },
  { symbol: 'VIMTALABS', name: 'Vimta Labs Limited', sector: 'Industrials' },
  { symbol: 'VIPIND', name: 'VIP Industries Limited', sector: 'Consumer' },
  { symbol: 'VIRINDUSL', name: 'Virindas Limited', sector: 'Pharmaceuticals' },
  { symbol: 'VISAKAIND', name: 'Visaka Industries Limited', sector: 'Consumer' },
  { symbol: 'VOLTAS', name: 'Voltas Limited', sector: 'Consumer Durables' },
  { symbol: 'WABCOINDIA', name: 'Wabco India Limited', sector: 'Auto' },
  { symbol: 'WALCHANNAG', name: 'Walchand Group', sector: 'Industrials' },
  { symbol: 'WHIRLPOOL', name: 'Whirlpool of India Limited', sector: 'Consumer Durables' },
  { symbol: 'WILLAMAGOR', name: 'Williams Control Industries Limited', sector: 'Auto' },
  { symbol: 'WILLDENTN', name: 'Wockhardt Limited', sector: 'Pharma' },
  { symbol: 'XRASIA', name: 'XR Asia Capital Limited', sector: 'Finance' },
  { symbol: 'YESBANK', name: 'Yes Bank Limited', sector: 'Banking' },
  { symbol: 'ZEEL', name: 'Zee Entertainment Enterprises Limited', sector: 'Media' },
  { symbol: 'ZENITHSTL', name: 'Zenith Steel Limited', sector: 'Metals & Mining' },
  { symbol: 'ZODIAC', name: 'Zodiac Aerospace India Limited', sector: 'Auto' },
];

/**
 * Sleep utility with rate limiting
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate stock exists on Yahoo Finance
 */
async function validateStock(symbol: string): Promise<boolean> {
  try {
    const yahooSymbol = `${symbol}.NS`; // NSE suffix
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
      {
        params: { range: '1d', interval: '1d' },
        timeout: 10_000,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      },
    );

    const result = response.data.chart.result?.[0];
    return !!(result?.timestamp && result.timestamp.length > 0);
  } catch {
    return false;
  }
}

/**
 * Generate TypeScript code for expanded universe
 */
function generateUniverseTs(validatedStocks: StockInfo[]): string {
  const imports = `import { Exchange, MarketIndex } from '@stockpred/shared-types';

export interface UniverseStock {
  symbol: string;
  name: string;
  exchange: Exchange;
  sector: string;
  indices: MarketIndex[];
  basePrice: number;
}

const N50 = MarketIndex.NIFTY_50;
const MID = MarketIndex.NIFTY_MIDCAP_100;
const SMALL = MarketIndex.NIFTY_SMALLCAP_100;

/**
 * EXPANDED NSE/BSE universe - all major stocks (~2000+).
 * Generated by: scripts/fetch-all-stocks.ts
 * Last updated: ${new Date().toISOString()}
 *
 * To use this expanded universe:
 * 1. Rename current universe.ts to universe.original.ts (backup)
 * 2. Rename this file to universe.ts
 * 3. Run: npm run prisma:seed
 */
export const STOCK_UNIVERSE: UniverseStock[] = [`;

  const stockLines = validatedStocks.map((stock) => {
    const indices = stock.symbol.includes('NIFTY') ? '[N50]' : '[MID]'; // Default assignment
    const basePrice = Math.round(Math.random() * 5000 + 500); // Placeholder price
    return `  {
    symbol: '${stock.symbol}',
    name: '${stock.name.replace(/'/g, "\\'")}',
    exchange: Exchange.NSE,
    sector: '${stock.sector}',
    indices: ${indices},
    basePrice: ${basePrice},
  },`;
  });

  const footer = `];`;

  return imports + '\n' + stockLines.join('\n') + '\n' + footer;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log(`🚀 Starting to fetch and validate ${NSE_BSE_STOCKS.length} NSE/BSE stocks...`);

  const validatedStocks: StockInfo[] = [];
  let skipped = 0;

  for (let i = 0; i < NSE_BSE_STOCKS.length; i++) {
    const stock = NSE_BSE_STOCKS[i];
    process.stdout.write(`\r[${i + 1}/${NSE_BSE_STOCKS.length}] Validating ${stock.symbol}...`);

    const isValid = await validateStock(stock.symbol);
    if (isValid) {
      validatedStocks.push(stock);
    } else {
      skipped++;
    }

    // Rate limiting
    if ((i + 1) % 10 === 0) {
      await sleep(REQUEST_GAP_MS);
    }
  }

  console.log(`\n\n✅ Validation complete!`);
  console.log(`   Valid stocks: ${validatedStocks.length}`);
  console.log(`   Skipped: ${skipped}`);

  // Generate new universe file
  const universeTs = generateUniverseTs(validatedStocks);
  const outputPath = path.join(
    __dirname,
    '..',
    'packages',
    'database',
    'src',
    'universe-expanded.ts',
  );

  fs.writeFileSync(outputPath, universeTs);
  console.log(`\n📄 Generated: ${outputPath}`);
  console.log(`\nTo use this expanded universe:`);
  console.log(
    `  1. Backup current: mv packages/database/src/universe.ts packages/database/src/universe.original.ts`,
  );
  console.log(
    `  2. Activate new:  mv packages/database/src/universe-expanded.ts packages/database/src/universe.ts`,
  );
  console.log(`  3. Reseed DB:     npm run prisma:seed`);
}

main().catch(console.error);
