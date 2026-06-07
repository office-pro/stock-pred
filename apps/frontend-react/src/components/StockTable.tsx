import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StockQuote } from '@stockpred/shared-types';
import { useAppSelector } from '../store';
import ChangeCell from './ChangeCell';

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '-';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Market dashboard table: live price, volume and the spec indicator set. Supports pagination and filtering. */
export default function StockTable({ stocks }: { stocks: StockQuote[] }): JSX.Element {
  const navigate = useNavigate();
  const ticks = useAppSelector((state) => state.live.ticks);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [searchFilter, setSearchFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);

  // Filter stocks by search term and sector
  const filteredStocks = useMemo(() => {
    return stocks.filter((stock) => {
      const matchesSearch =
        searchFilter === '' ||
        stock.symbol.toLowerCase().includes(searchFilter.toLowerCase()) ||
        stock.name.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesSector = sectorFilter === null || stock.sector === sectorFilter;
      return matchesSearch && matchesSector;
    });
  }, [stocks, searchFilter, sectorFilter]);

  // Get unique sectors for filter dropdown
  const sectors = useMemo(() => {
    const uniqueSectors = new Set(stocks.map((s) => s.sector));
    return Array.from(uniqueSectors).sort();
  }, [stocks]);

  // Paginate filtered results
  const paginatedStocks = filteredStocks.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  return (
    <Box>
      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search by symbol or name..."
          value={searchFilter}
          onChange={(e) => {
            setSearchFilter(e.target.value);
            setPage(0); // Reset to first page on filter change
          }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          select
          placeholder="Filter by sector..."
          value={sectorFilter || ''}
          onChange={(e) => {
            setSectorFilter(e.target.value === '' ? null : e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 150 }}
          SelectProps={{ native: true }}
        >
          <option value="">All Sectors</option>
          {sectors.map((sector) => (
            <option key={sector} value={sector}>
              {sector}
            </option>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
          {filteredStocks.length} stocks
        </Typography>
      </Box>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" data-testid="stock-table">
          <TableHead>
            <TableRow>
              <TableCell>Symbol</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="right">Chg %</TableCell>
              <TableCell align="right">Volume</TableCell>
              <TableCell align="right">VWAP</TableCell>
              <TableCell align="right">RSI</TableCell>
              <TableCell align="right">MACD</TableCell>
              <TableCell align="right">ATR</TableCell>
              <TableCell align="right">EMA20</TableCell>
              <TableCell align="right">EMA50</TableCell>
              <TableCell align="right">EMA200</TableCell>
              <TableCell align="right">BB Upper</TableCell>
              <TableCell align="right">BB Lower</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedStocks.map((stock) => {
              const tick = ticks[stock.symbol];
              const price = tick ? tick.price : stock.price;
              const changePercent =
                stock.previousClose > 0
                  ? ((price - stock.previousClose) / stock.previousClose) * 100
                  : stock.changePercent;
              const ind = stock.indicators;
              return (
                <TableRow
                  key={stock.symbol}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/stocks/${stock.symbol}`)}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {stock.symbol}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {stock.sector}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{fmt(price)}</TableCell>
                  <TableCell align="right">
                    <ChangeCell value={changePercent} />
                  </TableCell>
                  <TableCell align="right">{stock.volume.toLocaleString('en-IN')}</TableCell>
                  <TableCell align="right">{fmt(ind?.vwap)}</TableCell>
                  <TableCell align="right">{fmt(ind?.rsi, 1)}</TableCell>
                  <TableCell align="right">{fmt(ind?.macdHistogram)}</TableCell>
                  <TableCell align="right">{fmt(ind?.atr)}</TableCell>
                  <TableCell align="right">{fmt(ind?.ema20)}</TableCell>
                  <TableCell align="right">{fmt(ind?.ema50)}</TableCell>
                  <TableCell align="right">{fmt(ind?.ema200)}</TableCell>
                  <TableCell align="right">{fmt(ind?.bollingerUpper)}</TableCell>
                  <TableCell align="right">{fmt(ind?.bollingerLower)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination
          rowsPerPageOptions={[25, 50, 100]}
          component="div"
          count={filteredStocks.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </TableContainer>
    </Box>
  );
}
