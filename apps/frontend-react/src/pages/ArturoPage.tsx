import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { ArturoFlagRecord } from '@stockpred/shared-types';
import { useEffect, useMemo, useState } from 'react';
import ArturoFlagFormDrawer from '../components/arturo/ArturoFlagFormDrawer';
import ArturoWorkflowStrip from '../components/arturo/ArturoWorkflowStrip';
import { releaseModeChipColor, releaseModeLabel } from '../components/arturo/releaseModeLabels';
import { useArturoUiUnlock } from '../hooks/useArturoUiUnlock';
import {
  clearLocalOverride,
  getLocalOverride,
  resolveEffectiveEnabled,
  setLocalOverride,
} from '../lib/arturo-local-overrides';
import { useAppSelector } from '../store';
import {
  useEvaluateArturoFlagsMutation,
  useGetArturoFlagsQuery,
  useGetArturoStatusQuery,
} from '../store/api';

function formatUpdated(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return iso;
  }
}

export default function ArturoPage(): JSX.Element {
  const user = useAppSelector((s) => s.auth.user);
  const arturoUnlocked = useArturoUiUnlock();
  const { data: status } = useGetArturoStatusQuery(undefined, { skip: !arturoUnlocked });
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ArturoFlagRecord | null>(null);
  const [overrideTick, setOverrideTick] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data, isLoading, error, refetch } = useGetArturoFlagsQuery(
    {
      q: debouncedQ || undefined,
      pageSize: 100,
    },
    { skip: !arturoUnlocked },
  );
  const items = data?.items ?? [];
  const keys = useMemo(() => items.map((f) => f.key), [items]);
  const keysKey = keys.join('|');

  const [evaluate] = useEvaluateArturoFlagsMutation();
  const [serverMap, setServerMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!arturoUnlocked || keys.length === 0) {
      setServerMap({});
      return;
    }
    void evaluate({ keys })
      .unwrap()
      .then((res) => {
        const next: Record<string, boolean> = {};
        for (const r of res.results) next[r.key] = r.enabled;
        setServerMap(next);
      })
      .catch(() => setServerMap({}));
  }, [arturoUnlocked, keys, keysKey, evaluate]);

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (flag: ArturoFlagRecord): void => {
    setEditing(flag);
    setFormOpen(true);
  };

  const onToggleLocal = (flag: ArturoFlagRecord, next: boolean): void => {
    if (!user?.id) return;
    const serverEnabled = serverMap[flag.key] ?? false;
    if (next === serverEnabled) {
      clearLocalOverride(flag.key, user.id);
    } else {
      setLocalOverride(flag.key, user.id, next);
    }
    setOverrideTick((t) => t + 1);
  };

  if (!arturoUnlocked) {
    return (
      <Alert severity="info">
        ARTURO is locked. Open <strong>/admin/arturo?sha=develop</strong> to unlock the management
        UI for this session. Use <strong>?sha=off</strong> to hide it again.
      </Alert>
    );
  }

  if (status && !status.enabled) {
    return (
      <Alert severity="warning">
        ARTURO APIs are disabled on the server ({status.environment}). Set ARTURO_ENABLED=true on
        auth-service if you need CRUD/evaluate.
      </Alert>
    );
  }

  return (
    <Box data-testid="arturo-page">
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <FlagOutlinedIcon color="primary" />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              ARTURO
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Feature flags for development and testing — create, search, and manage release modes.
          </Typography>
        </Box>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          <TextField
            size="small"
            placeholder="Search name, key, description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ minWidth: { sm: 260 }, flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Create
          </Button>
        </Stack>
      </Stack>

      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        All ARTURO
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load flags. Ensure you are an admin and ARTURO is enabled.
        </Alert>
      ) : null}

      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'auto',
          bgcolor: 'background.paper',
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Flag Name</TableCell>
              <TableCell>Key</TableCell>
              <TableCell>Release Type</TableCell>
              <TableCell>Accounts / Comments</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((flag) => {
              void overrideTick;
              const local = user?.id ? getLocalOverride(flag.key, user.id) : undefined;
              const effective = resolveEffectiveEnabled(serverMap[flag.key] ?? false, local);
              return (
                <TableRow key={flag.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {flag.name}
                    </Typography>
                    {flag.description ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {flag.description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {flag.key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={releaseModeLabel(flag.releaseMode)}
                      color={releaseModeChipColor(flag.releaseMode)}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="caption" sx={{ wordBreak: 'break-word' }}>
                      {flag.accountRulesRaw || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Switch
                        size="small"
                        checked={effective.enabled}
                        onChange={(_, checked) => onToggleLocal(flag, checked)}
                        color="success"
                        inputProps={{ 'aria-label': `Toggle local override for ${flag.key}` }}
                      />
                      <Typography
                        variant="caption"
                        color={effective.enabled ? 'success.main' : 'text.secondary'}
                      >
                        {effective.enabled ? 'ON' : 'OFF'}
                      </Typography>
                      {effective.source === 'local' ? (
                        <Chip size="small" label="Local" color="warning" variant="outlined" />
                      ) : (
                        <Chip size="small" label="Server" variant="outlined" />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" display="block">
                      {formatUpdated(flag.updatedAt)}
                    </Typography>
                    {flag.updatedByName ? (
                      <Typography variant="caption" color="text.secondary">
                        {flag.updatedByName}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        aria-label={`Edit ${flag.key}`}
                        onClick={() => openEdit(flag)}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {!isLoading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No flags yet. Click Create to add one.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Box>

      <ArturoWorkflowStrip />

      <ArturoFlagFormDrawer
        open={formOpen}
        flag={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          void refetch();
        }}
      />
    </Box>
  );
}
