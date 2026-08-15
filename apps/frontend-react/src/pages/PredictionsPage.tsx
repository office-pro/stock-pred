import {
  Box,
  Chip,
  Pagination,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  TextField,
  Stack,
} from '@mui/material';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetAllPredictionsQuery } from '../store/api';

interface Prediction {
  symbol: string;
  horizon: string;
  direction: string;
  confidence: number;
  expectedMove: number;
  createdAt: string;
}

export default function PredictionsPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [searchSymbol, setSearchSymbol] = useState('');
  const [filterDirection, setFilterDirection] = useState<string | null>(null);
  const [filterHorizon, setFilterHorizon] = useState<string | null>(null);
  const limit = 50;

  const { data } = useGetAllPredictionsQuery(
    {
      page,
      limit,
      search: searchSymbol || undefined,
      horizon: filterHorizon ?? undefined,
      direction: filterDirection ?? undefined,
    },
    { pollingInterval: 30_000 },
  );

  const predictions = data?.predictions ?? [];
  const total = data?.total ?? predictions.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const getDirectionColor = (direction: string): 'success' | 'error' | 'warning' => {
    switch (direction) {
      case 'UP':
        return 'success';
      case 'DOWN':
        return 'error';
      default:
        return 'warning';
    }
  };

  const getDirectionBackground = (direction: string): string => {
    switch (direction) {
      case 'UP':
        return '#d4edda';
      case 'DOWN':
        return '#f8d7da';
      default:
        return '#fff3cd';
    }
  };

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        ML Predictions (All NSE/BSE Stocks)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Real-time ML predictions for all stocks. Models are updated every 5 minutes.
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          placeholder="Filter by symbol..."
          value={searchSymbol}
          onChange={(e) => {
            setSearchSymbol(e.target.value);
            setPage(1);
          }}
          size="small"
          sx={{ width: 200 }}
        />
        <Chip
          label={filterDirection ? `Direction: ${filterDirection}` : 'All Directions'}
          onClick={() => {
            setFilterDirection(filterDirection === null ? 'UP' : null);
            setPage(1);
          }}
          color={filterDirection === 'UP' ? 'success' : 'default'}
          variant="outlined"
        />
        <Chip
          label={filterHorizon || 'All Horizons'}
          onClick={() => {
            setFilterHorizon(
              filterHorizon === null
                ? 'NEXT_DAY'
                : filterHorizon === 'NEXT_DAY'
                  ? 'NEXT_WEEK'
                  : null,
            );
            setPage(1);
          }}
          color={filterHorizon ? 'primary' : 'default'}
          variant="outlined"
        />
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell>Symbol</TableCell>
              <TableCell>Horizon</TableCell>
              <TableCell>Direction</TableCell>
              <TableCell align="right">Confidence</TableCell>
              <TableCell align="right">Expected Move</TableCell>
              <TableCell align="right">Last Updated</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {predictions.length > 0 ? (
              predictions.map((pred: Prediction, idx: number) => (
                <TableRow
                  key={`${pred.symbol}-${pred.horizon}-${idx}`}
                  hover
                  sx={{
                    backgroundColor:
                      pred.confidence > 70
                        ? 'rgba(76, 175, 80, 0.05)'
                        : pred.confidence > 55
                          ? 'rgba(33, 150, 243, 0.05)'
                          : 'inherit',
                  }}
                >
                  <TableCell>
                    <Link to={`/stocks/${pred.symbol}`} style={{ color: '#4f8cff' }}>
                      <strong>{pred.symbol}</strong>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Chip label={pred.horizon} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={pred.direction}
                      size="small"
                      color={getDirectionColor(pred.direction)}
                      sx={{ backgroundColor: getDirectionBackground(pred.direction) }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Box
                      sx={{
                        fontWeight: 600,
                        color:
                          pred.confidence > 70
                            ? '#4caf50'
                            : pred.confidence > 55
                              ? '#2196f3'
                              : '#666',
                      }}
                    >
                      {pred.confidence.toFixed(1)}%
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    {pred.expectedMove > 0 ? (
                      <span style={{ color: '#4caf50' }}>+{pred.expectedMove.toFixed(2)}%</span>
                    ) : pred.expectedMove < 0 ? (
                      <span style={{ color: '#f44336' }}>{pred.expectedMove.toFixed(2)}%</span>
                    ) : (
                      <span>-</span>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="caption" color="text.secondary">
                      {new Date(pred.createdAt).toLocaleTimeString()}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    {data ? 'No predictions match your filters' : 'Loading predictions...'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination count={totalPages} page={page} onChange={(_e, value) => setPage(value)} />
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Showing {predictions.length} of {total} predictions (page {page}/{totalPages}). This is not
        investment advice.
      </Typography>
    </>
  );
}
