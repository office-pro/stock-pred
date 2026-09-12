import { Box, Chip, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LogoutIcon from '@mui/icons-material/Logout';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store';
import { logout } from '../store/authSlice';
import { useGetAgentModeQuery, useGetMarketDataContractQuery } from '../store/api';

/**
 * Top status bar — display only.
 * Never use liveUsable / DELAYED to gate Approve.
 */
export default function WorkstationHeader(): JSX.Element {
  const user = useAppSelector((s) => s.auth.user);
  const connected = useAppSelector((s) => s.live.connected);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState('');

  const { data: mode } = useGetAgentModeQuery(undefined, {
    pollingInterval: 15_000,
    skip: !user,
  });
  const { data: contract } = useGetMarketDataContractQuery(undefined, {
    pollingInterval: 15_000,
    skip: !user,
  });

  const onSearch = (e: FormEvent): void => {
    e.preventDefault();
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    navigate(`/stocks/${s}`);
    setSymbol('');
  };

  const quoteStatus = contract?.quoteStatus ?? 'UNKNOWN';
  const sessionOpen = contract?.nseCashSessionOpen;

  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        flexWrap: 'wrap',
        px: 2,
        py: 1.25,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box component="form" onSubmit={onSearch} sx={{ flex: '1 1 200px', maxWidth: 360 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search symbol…"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip
          size="small"
          label={mode?.mode ?? '—'}
          color={mode?.mode === 'LIVE' ? 'error' : 'primary'}
          variant="outlined"
        />
        <Chip
          size="small"
          label={sessionOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
          color={sessionOpen ? 'success' : 'default'}
        />
        <Chip
          size="small"
          label={quoteStatus}
          color={
            quoteStatus === 'LIVE'
              ? 'success'
              : quoteStatus === 'DELAYED'
                ? 'warning'
                : quoteStatus === 'STALE' || quoteStatus === 'UNKNOWN'
                  ? 'error'
                  : 'default'
          }
          variant="outlined"
        />
        <Chip
          size="small"
          label={connected ? 'ONLINE' : 'OFFLINE'}
          color={connected ? 'success' : 'default'}
          variant="outlined"
        />
        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 280 }}>
          Status only — DELAYED does not block Approve; STALE fails Risk.
        </Typography>
      </Stack>

      <Box sx={{ flexGrow: 1 }} />

      {user ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            {user.name}
            {user.brand?.name ? ` · ${user.brand.name}` : ''}
          </Typography>
          <IconButton
            size="small"
            aria-label="Logout"
            onClick={() => {
              dispatch(logout());
              navigate('/login');
            }}
          >
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Stack>
      ) : null}
    </Box>
  );
}
