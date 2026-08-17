import {
  Alert,
  Box,
  Chip,
  MenuItem,
  Pagination,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  MANIPULATION_DISCLAIMER,
  type ManipulationBand,
  type OverextensionRisk,
} from '@stockpred/shared-types';
import MarketContextBar from '../components/MarketContextBar';
import { useGetScannerQuery } from '../store/api';

const RISK_COLOR: Record<OverextensionRisk, 'default' | 'warning' | 'error'> = {
  NOT_EXTENDED: 'default',
  EXTENDED: 'warning',
  HIGH_RISK_BULLISH: 'error',
};

const UNUSUAL_COLOR: Record<ManipulationBand, 'default' | 'warning' | 'error'> = {
  NORMAL: 'default',
  SUSPICIOUS: 'warning',
  INVESTIGATE: 'error',
};

export default function ScannerPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [minScore, setMinScore] = useState(55);
  const [minInvestigate, setMinInvestigate] = useState(0);
  const [sort, setSort] = useState('score');
  const { data, isError, isFetching } = useGetScannerQuery(
    { page, limit: 40, minScore, sort, minInvestigate },
    { pollingInterval: 20_000 },
  );
  const rows = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 40)) : 1;

  return (
    <>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        Bull Run Scanner
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Ranked candidates from bull score, UP probability, and 20-session expected return. Unusual
        intensity compares today to that stock's own history and Nifty — {MANIPULATION_DISCLAIMER}{' '}
        These are probabilities and expected ranges, not a promise that a stock will rise. Not
        investment advice.
      </Alert>
      <MarketContextBar context={data?.context} />
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          select
          size="small"
          label="Min bull score"
          value={minScore}
          onChange={(event) => {
            setMinScore(Number(event.target.value));
            setPage(1);
          }}
          sx={{ width: 160 }}
        >
          {[45, 55, 70, 85].map((value) => (
            <MenuItem key={value} value={value}>
              {value}+
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Min unusual"
          value={minInvestigate}
          onChange={(event) => {
            setMinInvestigate(Number(event.target.value));
            setPage(1);
          }}
          sx={{ width: 150 }}
        >
          {[0, 40, 70].map((value) => (
            <MenuItem key={value} value={value}>
              {value === 0 ? 'Any' : `${value}+`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Sort"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          sx={{ width: 180 }}
        >
          <MenuItem value="score">Bull score</MenuItem>
          <MenuItem value="unusual">Unusual intensity</MenuItem>
          <MenuItem value="up">UP %</MenuItem>
          <MenuItem value="expected20d">20D expected</MenuItem>
          <MenuItem value="rs">NIFTY RS</MenuItem>
          <MenuItem value="volume">Volume</MenuItem>
        </TextField>
        {isFetching && (
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Updating…
          </Typography>
        )}
      </Box>
      {isError && <Alert severity="error">Could not load the scanner.</Alert>}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Stock</TableCell>
              <TableCell align="right">Score</TableCell>
              <TableCell>Band</TableCell>
              <TableCell align="right">Unusual</TableCell>
              <TableCell align="right">UP %</TableCell>
              <TableCell align="right">20D Exp</TableCell>
              <TableCell align="right">5D / 10D</TableCell>
              <TableCell>Risk</TableCell>
              <TableCell>Why</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const scan = row.scanner;
              const unusual = row.manipulation;
              const fc = scan?.forecast;
              return (
                <TableRow key={row.symbol} hover>
                  <TableCell>
                    <Typography
                      component={RouterLink}
                      to={`/stocks/${row.symbol}`}
                      sx={{ textDecoration: 'none', fontWeight: 700 }}
                    >
                      {row.symbol}
                    </Typography>
                    <Typography variant="caption" display="block" color="text.secondary">
                      ₹{row.price.toLocaleString('en-IN')}
                    </Typography>
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}
                  >
                    {scan?.bullScore ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={(scan?.band ?? 'NEUTRAL').replace(/_/g, ' ')} />
                  </TableCell>
                  <TableCell align="right">
                    {unusual ? (
                      <Chip
                        size="small"
                        color={UNUSUAL_COLOR[unusual.band]}
                        label={`${unusual.investigateIntensity} ${unusual.band}`}
                      />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fc ? `${fc.upProbability}%` : '—'}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      color: (fc?.expectedReturn20d ?? 0) >= 0 ? 'success.main' : 'error.main',
                    }}
                  >
                    {fc ? `${fc.expectedReturn20d >= 0 ? '+' : ''}${fc.expectedReturn20d}%` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fc
                      ? `${fc.expectedReturn5d >= 0 ? '+' : ''}${fc.expectedReturn5d}% / ${fc.expectedReturn10d >= 0 ? '+' : ''}${fc.expectedReturn10d}%`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {scan && (
                      <Chip
                        size="small"
                        color={RISK_COLOR[scan.risk]}
                        label={scan.risk.replace(/_/g, ' ')}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {(scan?.reasons ?? []).slice(0, 3).join(' · ') || '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography variant="body2" color="text.secondary">
                    No names cleared the score filter. Hydrate market-data history or lower the
                    minimum score.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
        <Pagination count={totalPages} page={page} onChange={(_e, value) => setPage(value)} />
      </Box>
    </>
  );
}
