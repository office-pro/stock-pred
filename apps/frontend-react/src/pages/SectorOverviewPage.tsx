/**
 * Sectors workstation — equal-weighted sector returns from MDS B9 intelligence.
 * Matches StockPred AI sectors dashboard layout. Advisory only — never invents ranks for trade auth.
 */
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useGetAllSectorsIntelligenceQuery, useGetSectorMediansQuery } from '../store/api';

type SectorRow = {
  status: string;
  reason?: string;
  sector: string;
  return1d?: number | null;
  return5d?: number | null;
  return15d?: number | null;
  return20d?: number | null;
  return60d?: number | null;
  return126d?: number | null;
  return252d?: number | null;
  breadthAdvancing?: number | null;
  breadthDeclining?: number | null;
  breadthUnchanged?: number | null;
  relativeStrength?: number | null;
  momentum?: number | null;
  volatility?: number | null;
  trendSeries?: number[];
  medianPe?: number | null;
  medianPb?: number | null;
  state: string;
  sessionDate?: string | null;
  dataStatus?: string | null;
  sessionCoverage?: {
    live: number;
    delayed: number;
    priorSession: number;
    closedMarket: number;
    stale: number;
    unavailable: number;
    newestDataAt?: number | null;
    oldestDataAt?: number | null;
  };
  leaders: Array<{
    symbol: string;
    return1d?: number | null;
    return5d?: number | null;
    return15d?: number | null;
    return20d?: number | null;
    return126d?: number | null;
    return252d?: number | null;
  }>;
  laggards: Array<{
    symbol: string;
    return1d?: number | null;
    return5d?: number | null;
    return15d?: number | null;
    return20d?: number | null;
    return126d?: number | null;
    return252d?: number | null;
  }>;
  coverageSymbols: number;
  memberCount?: number;
};

type PeriodKey = '1D' | '1W' | '15D' | '1M' | '6M' | '1Y';
type TableTab = 'overview' | 'fundamentals' | 'valuation' | 'breadth' | 'momentum';
type DetailTab = 'overview' | 'stocks' | 'fundamentals' | 'valuation';
type MemberSnap = SectorRow['leaders'][number];

const PERIODS: PeriodKey[] = ['1D', '1W', '15D', '1M', '6M', '1Y'];
const PERIOD_HINT: Record<PeriodKey, string> = {
  '1D': 'current session',
  '1W': '5 trading sessions',
  '15D': '15 trading sessions',
  '1M': '20 trading sessions',
  '6M': '126 trading sessions',
  '1Y': '252 trading sessions',
};

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n * 100;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function retFor(row: SectorRow, period: PeriodKey): number | null {
  switch (period) {
    case '1D':
      return row.return1d ?? null;
    case '1W':
      return row.return5d ?? null;
    case '15D':
      return row.return15d ?? null;
    case '1M':
      return row.return20d ?? null;
    case '6M':
      return row.return126d ?? null;
    case '1Y':
      return row.return252d ?? null;
    default:
      return null;
  }
}

function memberRet(m: MemberSnap, period: PeriodKey): number | null {
  switch (period) {
    case '1D':
      return m.return1d ?? null;
    case '1W':
      return m.return5d ?? null;
    case '15D':
      return m.return15d ?? null;
    case '1M':
      return m.return20d ?? null;
    case '6M':
      return m.return126d ?? null;
    case '1Y':
      return m.return252d ?? null;
    default:
      return null;
  }
}

function rankMembersByPeriod(
  leaders: MemberSnap[],
  laggards: MemberSnap[],
  period: PeriodKey,
): { leaders: MemberSnap[]; laggards: MemberSnap[] } {
  const map = new Map<string, MemberSnap>();
  for (const m of [...leaders, ...laggards]) map.set(m.symbol, m);
  const sorted = [...map.values()].sort(
    (a, b) => (memberRet(b, period) ?? -999) - (memberRet(a, period) ?? -999),
  );
  return {
    leaders: sorted.slice(0, Math.min(5, sorted.length)),
    laggards: sorted.slice(-Math.min(5, sorted.length)).reverse(),
  };
}

function heatBg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'transparent';
  const abs = Math.min(Math.abs(n) * 100, 12);
  const alpha = 0.12 + (abs / 12) * 0.45;
  if (n > 0) return `rgba(16, 185, 129, ${alpha})`;
  if (n < 0) return `rgba(239, 68, 68, ${alpha})`;
  return 'transparent';
}

function heatText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'text.secondary';
  if (n > 0) return '#34d399';
  if (n < 0) return '#f87171';
  return 'text.secondary';
}

function stateColor(state: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
  const s = state.toUpperCase();
  if (s === 'LEADING' || s === 'IMPROVING') return 'success';
  if (s === 'WEAKENING') return 'warning';
  if (s === 'LAGGING') return 'error';
  if (s === 'UNKNOWN') return 'default';
  return 'info';
}

function Sparkline({
  points,
  width = 88,
  height = 28,
  color = '#34d399',
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}): JSX.Element {
  if (!points.length) {
    return (
      <Box sx={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.disabled">
          —
        </Typography>
      </Box>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * (width - 4) + 2;
      const y = height - 2 - ((p - min) / span) * (height - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: string;
}): JSX.Element {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.75,
        flex: '1 1 160px',
        minWidth: 150,
        bgcolor: 'background.paper',
        borderColor: 'divider',
      }}
    >
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
        {label}
      </Typography>
      <Typography
        variant="h5"
        fontWeight={800}
        sx={{ color: accent ?? 'text.primary', lineHeight: 1.1 }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
        {hint}
      </Typography>
    </Paper>
  );
}

function PctCell({ value }: { value: number | null | undefined }): JSX.Element {
  return (
    <TableCell
      align="right"
      sx={{
        bgcolor: heatBg(value),
        color: heatText(value),
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {pct(value)}
    </TableCell>
  );
}

function MultiLineChart({
  series,
}: {
  series: Array<{ name: string; color: string; points: number[] }>;
}): JSX.Element {
  const w = 420;
  const h = 180;
  const usable = series.filter((s) => s.points.length > 1);
  if (!usable.length) {
    return (
      <Box sx={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Performance series Not available
        </Typography>
      </Box>
    );
  }
  const all = usable.flatMap((s) => s.points);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  return (
    <Box>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={0}
            x2={w}
            y1={h * g}
            y2={h * g}
            stroke="rgba(148,163,184,0.2)"
            strokeWidth={1}
          />
        ))}
        {usable.map((s) => {
          const d = s.points
            .map((p, i) => {
              const x = (i / Math.max(s.points.length - 1, 1)) * (w - 8) + 4;
              const y = h - 8 - ((p - min) / span) * (h - 16);
              return `${i === 0 ? 'M' : 'L'}${x},${y}`;
            })
            .join(' ');
          return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={2} />;
        })}
      </svg>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {usable.map((s) => {
          const last = s.points[s.points.length - 1];
          const first = s.points[0];
          const chg = first > 0 ? last / first - 1 : null;
          return (
            <Stack key={s.name} direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: s.color }} />
              <Typography variant="caption">
                {s.name} {pct(chg)}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

function Heatmap({ rows }: { rows: SectorRow[] }): JSX.Element {
  const items = [...rows]
    .filter((r) => r.return20d != null)
    .sort((a, b) => Math.abs(b.return20d ?? 0) - Math.abs(a.return20d ?? 0))
    .slice(0, 16);
  if (!items.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        Heatmap Not available
      </Typography>
    );
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0.75,
        minHeight: 180,
      }}
    >
      {items.map((r) => {
        const v = r.return20d ?? 0;
        return (
          <Box
            key={r.sector}
            sx={{
              p: 1.25,
              borderRadius: 1,
              bgcolor: heatBg(v * 1.4),
              border: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: 72,
            }}
          >
            <Typography variant="caption" fontWeight={700} noWrap>
              {r.sector}
            </Typography>
            <Typography variant="body2" fontWeight={800} sx={{ color: heatText(v) }}>
              {pct(v)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

const CHART_COLORS = ['#34d399', '#60a5fa', '#a78bfa', '#f87171', '#fbbf24'];

export default function SectorOverviewPage(): JSX.Element {
  const { data, isLoading, isError, isFetching } = useGetAllSectorsIntelligenceQuery({ limit: 80 });
  const { data: medians } = useGetSectorMediansQuery();
  const [universe, setUniverse] = useState('NIFTY 500');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [tableTab, setTableTab] = useState<TableTab>('overview');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [period, setPeriod] = useState<PeriodKey>('1M');
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const peBySector = useMemo(() => {
    const map = new Map<string, { medianPe: number | null; medianPb: number | null }>();
    for (const s of medians?.sectors ?? []) {
      map.set(s.sector.toUpperCase(), { medianPe: s.medianPe, medianPb: s.medianPb });
    }
    return map;
  }, [medians]);

  const rows: SectorRow[] = useMemo(() => {
    const list = (data?.sectors ?? []).map((s) => {
      const fund = peBySector.get(s.sector.toUpperCase());
      return {
        ...s,
        medianPe: s.medianPe ?? fund?.medianPe ?? null,
        medianPb: s.medianPb ?? fund?.medianPb ?? null,
        memberCount: s.memberCount ?? s.coverageSymbols,
        leaders: s.leaders ?? [],
        laggards: s.laggards ?? [],
      };
    });
    const filtered = sectorFilter === 'ALL' ? list : list.filter((r) => r.sector === sectorFilter);
    return [...filtered].sort((a, b) => (b.return20d ?? -999) - (a.return20d ?? -999));
  }, [data, peBySector, sectorFilter]);

  const selectedRow = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.sector === selected) ?? rows[0];
  }, [rows, selected]);

  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  const kpis = useMemo(() => {
    const tracked = rows.length;
    const up = rows.filter((r) => (r.return20d ?? 0) > 0).length;
    const down = rows.filter((r) => (r.return20d ?? 0) < 0).length;
    const top = rows[0];
    const weak = [...rows].sort((a, b) => (a.return20d ?? 999) - (b.return20d ?? 999))[0];
    return { tracked, up, down, top, weak };
  }, [rows]);

  const asOfLabel = useMemo(() => {
    const session = data?.sessionDate;
    const status = data?.dataStatus ?? '—';
    const raw = data?.asOf;
    let updated = '';
    if (raw) {
      try {
        updated = new Date(raw).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        updated = String(raw);
      }
    }
    const sessionBit = session ? `Session ${session}` : 'Session —';
    return `${sessionBit} · ${status}${updated ? ` · Updated ${updated}` : ''}`;
  }, [data?.asOf, data?.sessionDate, data?.dataStatus]);

  const coverage = data?.sessionCoverage;

  const periodMembers = useMemo(() => {
    if (!selectedRow) return { leaders: [] as MemberSnap[], laggards: [] as MemberSnap[] };
    return rankMembersByPeriod(selectedRow.leaders ?? [], selectedRow.laggards ?? [], period);
  }, [selectedRow, period]);

  const chartSeries = useMemo(() => {
    const picks = selectedRow
      ? [selectedRow, ...rows.filter((r) => r.sector !== selectedRow.sector).slice(0, 3)]
      : rows.slice(0, 4);
    return picks.map((r, i) => ({
      name: r.sector,
      color: CHART_COLORS[i % CHART_COLORS.length],
      points: r.trendSeries ?? [],
    }));
  }, [rows, selectedRow]);

  const exportCsv = () => {
    const header = [
      'rank',
      'sector',
      'stocks',
      '1D',
      '1W',
      '15D',
      '1M',
      '6M',
      '1Y',
      'state',
      'medianPe',
    ];
    const lines = rows.map((r, i) =>
      [
        i + 1,
        r.sector,
        r.memberCount ?? r.coverageSymbols,
        r.return1d ?? '',
        r.return5d ?? '',
        r.return15d ?? '',
        r.return20d ?? '',
        r.return126d ?? '',
        r.return252d ?? '',
        r.state,
        r.medianPe ?? '',
      ].join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sectors.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 2 }, maxWidth: 1480 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
        gap={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Sectors
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Equal-weighted sector returns and breadth from live market history. Advisory context
            only — does not authorize trades.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Select
            size="small"
            value={universe}
            onChange={(e) => setUniverse(String(e.target.value))}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="NIFTY 500">NIFTY 500</MenuItem>
            <MenuItem value="NIFTY 100">NIFTY 100</MenuItem>
            <MenuItem value="ALL">Full universe</MenuItem>
          </Select>
          <Select
            size="small"
            value={sectorFilter}
            onChange={(e) => {
              setSectorFilter(String(e.target.value));
              setPage(0);
            }}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="ALL">All Sectors</MenuItem>
            {(data?.sectors ?? []).map((s) => (
              <MenuItem key={s.sector} value={s.sector}>
                {s.sector}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            {asOfLabel}
            {isFetching ? ' · refreshing…' : ''}
          </Typography>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>
            Export
          </Button>
        </Stack>
      </Stack>

      {isLoading ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      ) : null}
      {isError ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Sector intelligence Not available from market-data.
        </Alert>
      ) : null}

      {!isLoading && rows.length > 0 ? (
        <>
          {data?.dataStatus === 'PRIOR_SESSION' ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              1D shows the prior completed trading session ({data.sessionDate ?? '—'}), not a live
              session — holiday/weekend/pre-open. Not LIVE 0%.
            </Alert>
          ) : null}
          {coverage ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={`Live ${coverage.live}`}
              />
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`Delayed ${coverage.delayed}`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`Prior session ${coverage.priorSession}`}
              />
              <Chip size="small" variant="outlined" label={`Closed ${coverage.closedMarket}`} />
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                1D session coverage · {PERIOD_HINT[period]}
              </Typography>
            </Stack>
          ) : null}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <KpiCard
              label="Sectors Tracked"
              value={String(kpis.tracked)}
              hint={`${universe} membership`}
            />
            <KpiCard
              label="Sectors in Uptrend (1M)"
              value={String(kpis.up)}
              hint={
                kpis.tracked ? `${Math.round((kpis.up / kpis.tracked) * 100)}% of sectors` : '—'
              }
              accent="#34d399"
            />
            <KpiCard
              label="Sectors in Downtrend (1M)"
              value={String(kpis.down)}
              hint={
                kpis.tracked ? `${Math.round((kpis.down / kpis.tracked) * 100)}% of sectors` : '—'
              }
              accent="#f87171"
            />
            <KpiCard
              label="Top Performing Sector (1M)"
              value={kpis.top?.sector ?? '—'}
              hint={pct(kpis.top?.return20d)}
              accent="#34d399"
            />
            <KpiCard
              label="Weakest Sector (1M)"
              value={kpis.weak?.sector ?? '—'}
              hint={pct(kpis.weak?.return20d)}
              accent="#f87171"
            />
          </Stack>

          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={2}
            alignItems="stretch"
            sx={{ mb: 2 }}
          >
            <Paper variant="outlined" sx={{ flex: 1.35, minWidth: 0, overflow: 'hidden' }}>
              <Tabs
                value={tableTab}
                onChange={(_, v: TableTab) => setTableTab(v)}
                variant="scrollable"
                sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}
              >
                <Tab value="overview" label="Overview" />
                <Tab value="fundamentals" label="Fundamentals" />
                <Tab value="valuation" label="Valuation" />
                <Tab value="breadth" label="Breadth" />
                <Tab value="momentum" label="Momentum" />
              </Tabs>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Sector</TableCell>
                      <TableCell align="right">Stocks</TableCell>
                      {tableTab === 'overview' || tableTab === 'momentum' ? (
                        <>
                          <TableCell align="right">1D</TableCell>
                          <TableCell align="right">1W</TableCell>
                          <TableCell align="right">15D</TableCell>
                          <TableCell align="right">1M</TableCell>
                          <TableCell align="right">6M</TableCell>
                          <TableCell align="right">1Y</TableCell>
                          <TableCell>Trend</TableCell>
                        </>
                      ) : null}
                      {tableTab === 'fundamentals' || tableTab === 'valuation' ? (
                        <>
                          <TableCell align="right">PE (Med)</TableCell>
                          <TableCell align="right">PB (Med)</TableCell>
                          <TableCell align="right">RS</TableCell>
                          <TableCell align="right">Vol</TableCell>
                        </>
                      ) : null}
                      {tableTab === 'breadth' ? (
                        <>
                          <TableCell align="right">Advancing</TableCell>
                          <TableCell align="right">Declining</TableCell>
                          <TableCell align="right">Unchanged</TableCell>
                          <TableCell>State</TableCell>
                        </>
                      ) : null}
                      <TableCell align="right">Rank</TableCell>
                      <TableCell align="right">View</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pageRows.map((r, idx) => {
                      const rank = page * pageSize + idx + 1;
                      const active = selectedRow?.sector === r.sector;
                      const trendUp = (r.return126d ?? r.return20d ?? 0) >= 0;
                      return (
                        <TableRow
                          key={r.sector}
                          hover
                          selected={active}
                          onClick={() => setSelected(r.sector)}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell>{rank}</TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={700}>
                              {r.sector}
                            </Typography>
                            <Chip
                              size="small"
                              label={r.state}
                              color={stateColor(r.state)}
                              sx={{ mt: 0.5, height: 20 }}
                            />
                          </TableCell>
                          <TableCell align="right">{r.memberCount ?? r.coverageSymbols}</TableCell>
                          {tableTab === 'overview' || tableTab === 'momentum' ? (
                            <>
                              <PctCell value={r.return1d} />
                              <PctCell value={r.return5d} />
                              <PctCell value={r.return15d} />
                              <PctCell value={r.return20d} />
                              <PctCell value={r.return126d} />
                              <PctCell value={r.return252d} />
                              <TableCell>
                                <Sparkline
                                  points={r.trendSeries ?? []}
                                  color={trendUp ? '#34d399' : '#f87171'}
                                />
                              </TableCell>
                            </>
                          ) : null}
                          {tableTab === 'fundamentals' || tableTab === 'valuation' ? (
                            <>
                              <TableCell align="right">
                                {r.medianPe != null ? r.medianPe.toFixed(1) : '—'}
                              </TableCell>
                              <TableCell align="right">
                                {r.medianPb != null ? r.medianPb.toFixed(2) : '—'}
                              </TableCell>
                              <TableCell align="right">
                                {r.relativeStrength != null ? r.relativeStrength.toFixed(2) : '—'}
                              </TableCell>
                              <TableCell align="right">
                                {r.volatility != null ? `${(r.volatility * 100).toFixed(1)}%` : '—'}
                              </TableCell>
                            </>
                          ) : null}
                          {tableTab === 'breadth' ? (
                            <>
                              <TableCell align="right" sx={{ color: '#34d399' }}>
                                {r.breadthAdvancing ?? '—'}
                              </TableCell>
                              <TableCell align="right" sx={{ color: '#f87171' }}>
                                {r.breadthDeclining ?? '—'}
                              </TableCell>
                              <TableCell align="right">{r.breadthUnchanged ?? '—'}</TableCell>
                              <TableCell>
                                <Chip size="small" label={r.state} color={stateColor(r.state)} />
                              </TableCell>
                            </>
                          ) : null}
                          <TableCell align="right">{rank}</TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(r.sector);
                              }}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack direction="row" justifyContent="flex-end" spacing={0.5} sx={{ p: 1 }}>
                {Array.from({ length: pageCount }, (_, i) => (
                  <Button
                    key={i}
                    size="small"
                    variant={page === i ? 'contained' : 'text'}
                    onClick={() => setPage(i)}
                    sx={{ minWidth: 32 }}
                  >
                    {i + 1}
                  </Button>
                ))}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ flex: 1, minWidth: 280, p: 2 }}>
              {selectedRow ? (
                <>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography variant="h6" fontWeight={800}>
                        {selectedRow.sector} Sector
                      </Typography>
                      <Chip
                        size="small"
                        label={selectedRow.state}
                        color={stateColor(selectedRow.state)}
                        sx={{ mt: 0.75 }}
                      />
                    </Box>
                    <Button
                      size="small"
                      component={RouterLink}
                      to={`/batch`}
                      endIcon={<OpenInNewIcon fontSize="small" />}
                    >
                      View All Stocks
                    </Button>
                  </Stack>

                  <Tabs
                    value={detailTab}
                    onChange={(_, v: DetailTab) => setDetailTab(v)}
                    sx={{ mt: 1, mb: 1.5, borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Tab value="overview" label="Overview" />
                    <Tab value="stocks" label="Stocks" />
                    <Tab value="fundamentals" label="Fundamentals" />
                    <Tab value="valuation" label="Valuation" />
                  </Tabs>

                  {(detailTab === 'overview' || detailTab === 'stocks') && (
                    <>
                      <Typography
                        variant="h3"
                        fontWeight={800}
                        sx={{ color: heatText(retFor(selectedRow, period)) }}
                      >
                        {pct(retFor(selectedRow, period))}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {period} Return (equal-weighted)
                      </Typography>
                      <Box sx={{ my: 1.5 }}>
                        <Sparkline
                          points={selectedRow.trendSeries ?? []}
                          width={360}
                          height={72}
                          color={
                            heatText(retFor(selectedRow, period)) === '#f87171'
                              ? '#f87171'
                              : '#34d399'
                          }
                        />
                      </Box>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ mb: 2 }}
                      >
                        {PERIODS.map((p) => (
                          <Chip
                            key={p}
                            size="small"
                            label={`${p} ${pct(retFor(selectedRow, p))}`}
                            color={period === p ? 'primary' : 'default'}
                            variant={period === p ? 'filled' : 'outlined'}
                            onClick={() => setPeriod(p)}
                          />
                        ))}
                      </Stack>
                      <Stack spacing={0.75}>
                        <Typography variant="body2">
                          Stocks in Sector:{' '}
                          <strong>{selectedRow.memberCount ?? selectedRow.coverageSymbols}</strong>
                        </Typography>
                        <Typography variant="body2">
                          Advancing / Declining:{' '}
                          <strong>
                            {selectedRow.breadthAdvancing ?? '—'} /{' '}
                            {selectedRow.breadthDeclining ?? '—'}
                          </strong>
                        </Typography>
                        <Typography variant="body2">
                          PE (Median):{' '}
                          <strong>
                            {selectedRow.medianPe != null ? selectedRow.medianPe.toFixed(1) : '—'}
                          </strong>
                        </Typography>
                        <Typography variant="body2">
                          PB (Median):{' '}
                          <strong>
                            {selectedRow.medianPb != null ? selectedRow.medianPb.toFixed(2) : '—'}
                          </strong>
                        </Typography>
                        <Typography variant="body2">
                          Coverage with history: <strong>{selectedRow.coverageSymbols}</strong>
                        </Typography>
                      </Stack>
                    </>
                  )}

                  {(detailTab === 'fundamentals' || detailTab === 'valuation') && (
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      <Typography variant="body2">
                        Median PE:{' '}
                        {selectedRow.medianPe != null
                          ? selectedRow.medianPe.toFixed(1)
                          : 'Not available'}
                      </Typography>
                      <Typography variant="body2">
                        Median PB:{' '}
                        {selectedRow.medianPb != null
                          ? selectedRow.medianPb.toFixed(2)
                          : 'Not available'}
                      </Typography>
                      <Typography variant="body2">
                        Relative Strength:{' '}
                        {selectedRow.relativeStrength != null
                          ? selectedRow.relativeStrength.toFixed(3)
                          : 'Not available'}
                      </Typography>
                      <Typography variant="body2">
                        Volatility (20d):{' '}
                        {selectedRow.volatility != null
                          ? `${(selectedRow.volatility * 100).toFixed(2)}%`
                          : 'Not available'}
                      </Typography>
                    </Stack>
                  )}

                  {detailTab === 'stocks' && (
                    <Stack spacing={1} sx={{ mt: 2 }}>
                      <Typography variant="subtitle2" fontWeight={700}>
                        Leaders ({period})
                      </Typography>
                      {periodMembers.leaders.map((l) => (
                        <Stack key={l.symbol} direction="row" justifyContent="space-between">
                          <Typography
                            component={RouterLink}
                            to={`/stocks/${l.symbol}`}
                            variant="body2"
                            sx={{ color: 'primary.main', textDecoration: 'none' }}
                          >
                            {l.symbol}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ color: heatText(memberRet(l, period)) }}
                          >
                            {pct(memberRet(l, period))}
                          </Typography>
                        </Stack>
                      ))}
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 1 }}>
                        Laggards ({period})
                      </Typography>
                      {periodMembers.laggards.map((l) => (
                        <Stack key={l.symbol} direction="row" justifyContent="space-between">
                          <Typography
                            component={RouterLink}
                            to={`/stocks/${l.symbol}`}
                            variant="body2"
                            sx={{ color: 'primary.main', textDecoration: 'none' }}
                          >
                            {l.symbol}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ color: heatText(memberRet(l, period)) }}
                          >
                            {pct(memberRet(l, period))}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </>
              ) : (
                <Typography color="text.secondary">Select a sector to inspect detail.</Typography>
              )}
            </Paper>
          </Stack>

          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <Paper variant="outlined" sx={{ flex: 1, p: 2, minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                Sector Heatmap (1M Return)
              </Typography>
              <Heatmap rows={rows} />
            </Paper>
            <Paper variant="outlined" sx={{ flex: 1.2, p: 2, minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                Sector Performance Chart
              </Typography>
              <MultiLineChart series={chartSeries} />
            </Paper>
            <Paper variant="outlined" sx={{ flex: 0.9, p: 2, minWidth: 220 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Top Gainers / Losers ({period})
              </Typography>
              <Stack direction="row" spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="success.main" fontWeight={700}>
                    Gainers
                  </Typography>
                  {periodMembers.leaders.slice(0, 5).map((l) => (
                    <Stack
                      key={l.symbol}
                      direction="row"
                      justifyContent="space-between"
                      sx={{ mt: 0.75 }}
                    >
                      <Typography variant="body2">{l.symbol}</Typography>
                      <Typography variant="body2" sx={{ color: '#34d399' }}>
                        {pct(memberRet(l, period))}
                      </Typography>
                    </Stack>
                  ))}
                  {!periodMembers.leaders.length ? (
                    <Typography variant="caption" color="text.secondary">
                      Not available
                    </Typography>
                  ) : null}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="error.main" fontWeight={700}>
                    Losers
                  </Typography>
                  {periodMembers.laggards.slice(0, 5).map((l) => (
                    <Stack
                      key={l.symbol}
                      direction="row"
                      justifyContent="space-between"
                      sx={{ mt: 0.75 }}
                    >
                      <Typography variant="body2">{l.symbol}</Typography>
                      <Typography variant="body2" sx={{ color: '#f87171' }}>
                        {pct(memberRet(l, period))}
                      </Typography>
                    </Stack>
                  ))}
                  {!periodMembers.laggards.length ? (
                    <Typography variant="caption" color="text.secondary">
                      Not available
                    </Typography>
                  ) : null}
                </Box>
              </Stack>
            </Paper>
          </Stack>

          <Typography variant="caption" color="text.secondary" display="block">
            Sector returns are calculated using equal-weighted average of constituent stocks with
            sufficient daily history. Data: {asOfLabel}. This does not authorize trades.
          </Typography>
        </>
      ) : null}

      {!isLoading && !isError && rows.length === 0 ? (
        <Alert severity="info">
          No sector rows yet. Ensure market-data has sector membership and daily candles loaded.
        </Alert>
      ) : null}
    </Box>
  );
}
