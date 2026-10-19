import { Alert, Box, Button, Drawer, Stack, TextField, Typography } from '@mui/material';
import { ARTURO_FLAG_KEY_HINT, ArturoFlagRecord, ArturoReleaseMode } from '@stockpred/shared-types';
import { FormEvent, useEffect, useState } from 'react';
import { useCreateArturoFlagMutation, useUpdateArturoFlagMutation } from '../../store/api';
import { RELEASE_MODE_OPTIONS } from './releaseModeLabels';

export default function ArturoFlagFormDrawer({
  open,
  flag,
  onClose,
}: {
  open: boolean;
  flag: ArturoFlagRecord | null;
  onClose: () => void;
}): JSX.Element {
  const isEdit = Boolean(flag);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [releaseMode, setReleaseMode] = useState<ArturoReleaseMode>(ArturoReleaseMode.OFF);
  const [accountRulesRaw, setAccountRulesRaw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [createFlag, createState] = useCreateArturoFlagMutation();
  const [updateFlag, updateState] = useUpdateArturoFlagMutation();
  const saving = createState.isLoading || updateState.isLoading;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (flag) {
      setName(flag.name);
      setKey(flag.key);
      setDescription(flag.description ?? '');
      setReleaseMode(flag.releaseMode);
      setAccountRulesRaw(flag.accountRulesRaw);
    } else {
      setName('');
      setKey('');
      setDescription('');
      setReleaseMode(ArturoReleaseMode.OFF);
      setAccountRulesRaw('');
    }
  }, [open, flag]);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && flag) {
        await updateFlag({
          key: flag.key,
          name,
          description,
          releaseMode,
          accountRulesRaw,
          expectedVersion: flag.version,
        }).unwrap();
      } else {
        await createFlag({
          key,
          name,
          description: description || undefined,
          releaseMode,
          accountRulesRaw,
        }).unwrap();
      }
      onClose();
    } catch (err) {
      const msg =
        (err as { data?: { message?: string | string[] } })?.data?.message ??
        (err as Error)?.message ??
        'Save failed';
      setError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box
        component="form"
        onSubmit={(e) => void onSubmit(e)}
        sx={{
          width: { xs: 340, sm: 420 },
          p: 2.5,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
        }}
        data-testid="arturo-flag-form-drawer"
      >
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          Create / Edit ARTURO
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configure release mode and account targeting for this flag.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Stack spacing={2} sx={{ flex: 1, overflow: 'auto', pb: 2 }}>
          <TextField
            label="Flag Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            size="small"
          />
          <TextField
            label="Key"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            required
            fullWidth
            size="small"
            disabled={isEdit}
            placeholder="feat_desk_experimental_chip"
            helperText={isEdit ? 'Key is immutable once created' : ARTURO_FLAG_KEY_HINT}
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
            placeholder="Optional"
          />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Release Type
            </Typography>
            <Stack spacing={1}>
              {RELEASE_MODE_OPTIONS.map((opt) => {
                const selected = releaseMode === opt.mode;
                return (
                  <Box
                    key={opt.mode}
                    role="button"
                    tabIndex={0}
                    onClick={() => setReleaseMode(opt.mode)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        setReleaseMode(opt.mode);
                      }
                    }}
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      border: 2,
                      borderColor: selected ? 'primary.main' : 'divider',
                      bgcolor: selected ? 'action.selected' : 'transparent',
                      cursor: 'pointer',
                      '&:hover': { borderColor: 'primary.light' },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {opt.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {opt.description}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <TextField
            label="Accounts / Comments"
            value={accountRulesRaw}
            onChange={(e) => setAccountRulesRaw(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={3}
            placeholder="acme.local, beta.co, -demo.local"
          />
          <Alert severity="info" variant="outlined">
            <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
              Examples
            </Typography>
            <Typography variant="caption" component="div">
              Inclusion: <code>acme.local</code>
            </Typography>
            <Typography variant="caption" component="div">
              Exclusion: <code>-demo.local</code>
            </Typography>
          </Alert>
        </Stack>

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 1 }}>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={saving || !name || (!isEdit && !key)}>
            Save
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
