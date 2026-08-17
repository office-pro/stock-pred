import { useEffect, useState, type ReactNode } from 'react';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { Box, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { PaperHolding } from '@stockpred/shared-types';
import { useLiveQuote } from '../hooks/useLiveQuote';
import { formatListedTime, formatQuoteDelay, paperPnl } from '../lib/paper-pnl';

function inr(value: number): string {
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedInr(value: number): string {
  const formatted = inr(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function Stat({ label, children }: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

/** Live last, paper buy, and open P&L for a symbol. */
export default function LivePriceStrip({
  symbol,
  quotePrice,
  changePercent,
  listedAt,
  holding,
  embedded = false,
}: {
  symbol: string;
  quotePrice?: number;
  changePercent?: number;
  listedAt?: number | null;
  previousClose?: number | null;
  holding?: PaperHolding | null;
  embedded?: boolean;
}): JSX.Element {
  const liveQuote = useLiveQuote(symbol);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const last = liveQuote.price > 0 ? liveQuote.price : (quotePrice ?? 0);
  const listedStamp = formatListedTime(liveQuote.listedAt ?? listedAt);
  const delayLabel = formatQuoteDelay(liveQuote.listedAt ?? listedAt, now);
  const dayPct = liveQuote.changePercent ?? changePercent;
  const live = liveQuote.live;
  const boughtAt = holding?.entryPrice ?? 0;
  const qty = holding?.quantity ?? 0;
  const pnl = holding ? paperPnl({ live: last, boughtAt, quantity: qty }) : null;
  const inProfit = (pnl?.amount ?? 0) > 0;
  const inLoss = (pnl?.amount ?? 0) < 0;
  const pnlColor = inProfit ? 'success.main' : inLoss ? 'error.main' : 'text.primary';
  const pnlLabel = inProfit ? 'In profit' : inLoss ? 'In loss' : 'Flat';
  const refreshHint = live
    ? 'Auto-refreshing last listed trade (price and exchange time)'
    : 'Last listed trade · polling every 3s';

  return (
    <Paper
      variant={embedded ? undefined : 'outlined'}
      elevation={embedded ? 0 : undefined}
      sx={{
        p: embedded ? 0 : 2,
        mb: embedded ? 0 : 2,
        bgcolor: embedded ? 'transparent' : undefined,
      }}
      data-testid={`live-price-${symbol}`}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1.5, sm: 4 }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        flexWrap="wrap"
      >
        <Stat
          label={
            <Stack direction="row" spacing={0.5} alignItems="center" component="span">
              Live price
              <Tooltip title={refreshHint}>
                <AutorenewIcon
                  fontSize="small"
                  data-testid="price-autorefresh"
                  aria-label={refreshHint}
                  sx={{
                    fontSize: 16,
                    color: live ? 'success.main' : 'text.disabled',
                    animation: live ? 'live-price-spin 1.2s linear infinite' : 'none',
                    '@keyframes live-price-spin': {
                      to: { transform: 'rotate(360deg)' },
                    },
                  }}
                />
              </Tooltip>
            </Stack>
          }
        >
          <Stack spacing={0.25}>
            <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
              <Typography
                variant="h5"
                sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
              >
                {last > 0 ? inr(last) : '—'}
              </Typography>
              {dayPct != null && Number.isFinite(dayPct) && (
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    color:
                      dayPct > 0 ? 'success.main' : dayPct < 0 ? 'error.main' : 'text.secondary',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {dayPct > 0 ? '+' : ''}
                  {dayPct.toFixed(2)}%
                </Typography>
              )}
            </Stack>
            {(listedStamp || delayLabel) && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                data-testid="listed-at"
              >
                {listedStamp ? `listed ${listedStamp}` : null}
                {listedStamp && delayLabel ? ' · ' : null}
                {delayLabel}
              </Typography>
            )}
          </Stack>
        </Stat>
        <Stat label="Bought at">
          <Typography
            variant="h6"
            sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
          >
            {holding ? inr(boughtAt) : '—'}
          </Typography>
        </Stat>
        <Stat label="Paper P&L">
          {pnl && holding ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                size="small"
                color={inProfit ? 'success' : inLoss ? 'error' : 'default'}
                label={pnlLabel}
                sx={{ fontWeight: 700 }}
              />
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 800,
                  color: pnlColor,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.2,
                }}
              >
                {pnl.percent >= 0 ? '+' : ''}
                {pnl.percent.toFixed(2)}%
              </Typography>
              <Typography
                variant="body1"
                sx={{ fontWeight: 700, color: pnlColor, fontVariantNumeric: 'tabular-nums' }}
              >
                {signedInr(pnl.amount)}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No open paper lot
            </Typography>
          )}
        </Stat>
      </Stack>
    </Paper>
  );
}
