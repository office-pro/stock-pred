import {
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  TextField,
  Pagination,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../store';
import { useGetSignalsQuery, useGetSignalsPaginatedQuery } from '../store/api';

interface Signal {
  id?: string;
  symbol: string;
  signal: string;
  confidence: number;
  price: number;
  target: number;
  stopLoss: number;
  riskReward: number;
  createdAt?: string;
  rules?: Record<string, boolean>;
}

export default function SignalsPage(): JSX.Element {
  const [showAll, setShowAll] = useState(true);
  const [searchSymbol, setSearchSymbol] = useState('');
  const [signalFilter, setSignalFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const limit = 50;

  // Fetch actionable signals (traditional)
  const { data: signals } = useGetSignalsQuery(undefined, { pollingInterval: 15_000 });

  // Fetch paginated signals for all stocks
  const { data: paginatedData, isLoading: isPaginatedLoading } = useGetSignalsPaginatedQuery(
    {
      page,
      limit,
      search: searchSymbol,
      signal: signalFilter,
      all: true,
    },
    { skip: !showAll },
  );

  const liveFeed = useAppSelector((state) => state.live.signalFeed);

  const getSignalColor = (signal: string): 'success' | 'error' | 'warning' => {
    switch (signal?.toUpperCase()) {
      case 'BUY':
        return 'success';
      case 'SELL':
        return 'error';
      default:
        return 'warning';
    }
  };

  const getSignalBackground = (signal: string): string => {
    switch (signal?.toUpperCase()) {
      case 'BUY':
        return '#d4edda';
      case 'SELL':
        return '#f8d7da';
      default:
        return '#fff3cd';
    }
  };

  const displaySignals = showAll ? (paginatedData?.data ?? []) : ((signals ?? []) as Signal[]);
  const totalPages = showAll ? Math.ceil((paginatedData?.total ?? 0) / limit) : 1;
  const totalCount = showAll ? (paginatedData?.total ?? 0) : displaySignals.length;

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {showAll ? 'All Signals (5000+ NSE/BSE Stocks)' : 'Actionable Signals'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {showAll
              ? 'Current signal state for all stocks with pagination'
              : 'Rule-confirmed BUY/SELL trade setups'}
          </Typography>
        </Box>
        <Button
          variant={showAll ? 'contained' : 'outlined'}
          onClick={() => {
            setShowAll(!showAll);
            setPage(1);
            setSearchSymbol('');
            setSignalFilter('');
          }}
          size="small"
        >
          {showAll ? 'Show Actionable' : 'Show All Signals'}
        </Button>
      </Box>

      {liveFeed.length > 0 && !showAll && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {liveFeed.length} live signal(s) received this session.
        </Typography>
      )}

      {showAll && (
        <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'flex-end' }}>
          <TextField
            placeholder="Search by symbol..."
            value={searchSymbol}
            onChange={(e) => {
              setSearchSymbol(e.target.value);
              setPage(1);
            }}
            size="small"
            sx={{ width: 200 }}
          />
          <FormControl sx={{ width: 150 }} size="small">
            <InputLabel>Signal Type</InputLabel>
            <Select
              value={signalFilter}
              label="Signal Type"
              onChange={(e) => {
                setSignalFilter(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="">All Signals</MenuItem>
              <MenuItem value="BUY">BUY Only</MenuItem>
              <MenuItem value="SELL">SELL Only</MenuItem>
              <MenuItem value="HOLD">HOLD Only</MenuItem>
            </Select>
          </FormControl>
        </Box>
      )}

      {isPaginatedLoading && showAll ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                  <TableCell>Time</TableCell>
                  <TableCell>Symbol</TableCell>
                  <TableCell>Signal</TableCell>
                  <TableCell align="right">Confidence</TableCell>
                  <TableCell align="right">Price</TableCell>
                  {!showAll && (
                    <>
                      <TableCell align="right">Target</TableCell>
                      <TableCell align="right">Stop Loss</TableCell>
                      <TableCell align="right">R:R</TableCell>
                    </>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {displaySignals && displaySignals.length > 0 ? (
                  displaySignals.map((signal) => (
                    <TableRow
                      key={signal.id || signal.symbol}
                      hover
                      sx={{
                        backgroundColor:
                          signal.confidence > 0.8
                            ? 'rgba(76, 175, 80, 0.05)'
                            : signal.confidence > 0.6
                              ? 'rgba(33, 150, 243, 0.05)'
                              : 'inherit',
                      }}
                    >
                      <TableCell>
                        {signal.createdAt ? new Date(signal.createdAt).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        <Link to={`/stocks/${signal.symbol}`} style={{ color: '#4f8cff' }}>
                          <strong>{signal.symbol}</strong>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={signal.signal}
                          size="small"
                          color={getSignalColor(signal.signal)}
                          sx={{ backgroundColor: getSignalBackground(signal.signal) }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Box
                          sx={{
                            fontWeight: 600,
                            color:
                              signal.confidence > 0.8
                                ? '#4caf50'
                                : signal.confidence > 0.6
                                  ? '#2196f3'
                                  : '#666',
                          }}
                        >
                          {typeof signal.confidence === 'number'
                            ? `${(signal.confidence * 100).toFixed(1)}%`
                            : signal.confidence}
                        </Box>
                      </TableCell>
                      <TableCell align="right">{signal.price?.toFixed(2)}</TableCell>
                      {!showAll && (
                        <>
                          <TableCell align="right">{signal.target?.toFixed(2)}</TableCell>
                          <TableCell align="right">{signal.stopLoss?.toFixed(2)}</TableCell>
                          <TableCell align="right">{signal.riskReward?.toFixed(2)}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={showAll ? 5 : 8}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        {showAll
                          ? 'No signals match your filters'
                          : 'No actionable signals yet - the engine emits only rule-confirmed BUY/SELL setups.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {showAll && totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={handlePageChange}
                color="primary"
              />
            </Box>
          )}

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              {showAll
                ? `Showing ${displaySignals.length} of ${totalCount} signals`
                : `Showing ${displaySignals.length} signals`}
              . This is not investment advice.
            </Typography>
            {showAll && (
              <Typography variant="body2" color="text.secondary">
                Page {page} of {totalPages}
              </Typography>
            )}
          </Box>
        </>
      )}
    </>
  );
}
