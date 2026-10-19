import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { getLocalOverride, resolveEffectiveEnabled } from '../../lib/arturo-local-overrides';
import { useAppSelector } from '../../store';
import { useEvaluateArturoFlagsMutation, useGetArturoFlagsQuery } from '../../store/api';
import { releaseModeChipColor, releaseModeLabel } from './releaseModeLabels';

export default function ArturoQuickDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const user = useAppSelector((s) => s.auth.user);
  const [q, setQ] = useState('');
  const { data, isFetching } = useGetArturoFlagsQuery(
    { q: q.trim() || undefined, pageSize: 50 },
    { skip: !open },
  );
  const [evaluate, evalState] = useEvaluateArturoFlagsMutation();
  const [serverMap, setServerMap] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);

  const items = data?.items ?? [];
  const keys = useMemo(() => items.map((f) => f.key), [items]);
  const keysKey = keys.join('|');

  useEffect(() => {
    if (!open || keys.length === 0) return;
    void evaluate({ keys })
      .unwrap()
      .then((res) => {
        const next: Record<string, boolean> = {};
        for (const r of res.results) next[r.key] = r.enabled;
        setServerMap(next);
      })
      .catch(() => setServerMap({}));
  }, [open, keys, keysKey, evaluate]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box
        sx={{
          width: { xs: 320, sm: 400 },
          p: 2,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
        }}
        data-testid="arturo-quick-drawer"
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <FlagOutlinedIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              ARTURO
            </Typography>
          </Stack>
          <IconButton aria-label="Close ARTURO" onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Feature flags for development and testing
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder="Search flags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ mb: 1 }}
        />
        <Divider sx={{ mb: 1 }} />
        <List dense sx={{ flex: 1, overflow: 'auto' }}>
          {items.map((flag) => {
            const local = user?.id !== undefined ? getLocalOverride(flag.key, user.id) : undefined;
            // re-read when tick changes after external clear
            void tick;
            const effective = resolveEffectiveEnabled(serverMap[flag.key] ?? false, local);
            return (
              <ListItemButton key={flag.id} disableRipple sx={{ alignItems: 'flex-start' }}>
                <ListItemText
                  primary={flag.name}
                  secondary={
                    <Stack component="span" spacing={0.5} sx={{ mt: 0.5 }}>
                      <Typography variant="caption" component="span" color="text.secondary">
                        {flag.key}
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        <Chip
                          size="small"
                          label={releaseModeLabel(flag.releaseMode)}
                          color={releaseModeChipColor(flag.releaseMode)}
                          variant="outlined"
                        />
                        <Chip
                          size="small"
                          label={effective.enabled ? 'ON' : 'OFF'}
                          color={effective.enabled ? 'success' : 'default'}
                        />
                        {effective.source === 'local' ? (
                          <Chip size="small" label="Local" color="warning" variant="outlined" />
                        ) : null}
                      </Stack>
                    </Stack>
                  }
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
              </ListItemButton>
            );
          })}
          {!isFetching && !evalState.isLoading && items.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
              No flags found
            </Typography>
          ) : null}
        </List>
        <Button
          component={RouterLink}
          to="/admin/arturo"
          variant="outlined"
          fullWidth
          onClick={() => {
            setTick((t) => t + 1);
            onClose();
          }}
          sx={{ mt: 1 }}
        >
          Open ARTURO management
        </Button>
      </Box>
    </Drawer>
  );
}
