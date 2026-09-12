import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store';
import { useRequestExtensionMutation } from '../store/api';
import { logout } from '../store/authSlice';

const PRESETS = [
  { label: '1 hour', hours: 1 },
  { label: '2 hours', hours: 2 },
  { label: '1 day', days: 1 },
  { label: '2 days', days: 2 },
  { label: '1 week', days: 7 },
];

export default function AccessExpiredPage(): JSX.Element {
  const user = useAppSelector((s) => s.auth.user);
  const dispatch = useAppDispatch();
  const [preset, setPreset] = useState('2');
  const [days, setDays] = useState('0');
  const [hours, setHours] = useState('2');
  const [minutes, setMinutes] = useState('0');
  const [notes, setNotes] = useState('');
  const [requestExtension, state] = useRequestExtensionMutation();

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const body =
      preset === 'custom'
        ? {
            days: Number(days) || 0,
            hours: Number(hours) || 0,
            minutes: Number(minutes) || 0,
            notes,
          }
        : {
            days: PRESETS[Number(preset)]?.days ?? 0,
            hours: PRESETS[Number(preset)]?.hours ?? 0,
            minutes: 0,
            notes,
          };
    await requestExtension(body);
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
      <Card variant="outlined" sx={{ width: 440 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Demo access expired
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {user?.name}, your viewer window ended
            {user?.accessExpiresAt ? ` at ${new Date(user.accessExpiresAt).toLocaleString()}` : ''}.
            Request an extension — an admin will approve it.
          </Typography>
          {state.isSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Extension request submitted. An admin will review it.
            </Alert>
          )}
          {state.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Could not submit request. Try again or contact your admin.
            </Alert>
          )}
          <Box component="form" onSubmit={(e) => void onSubmit(e)}>
            <TextField
              select
              fullWidth
              label="Duration"
              margin="normal"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {PRESETS.map((p, i) => (
                <MenuItem key={p.label} value={String(i)}>
                  {p.label}
                </MenuItem>
              ))}
              <MenuItem value="custom">Custom</MenuItem>
            </TextField>
            {preset === 'custom' && (
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Days"
                  type="number"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
                <TextField
                  label="Hours"
                  type="number"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
                <TextField
                  label="Mins"
                  type="number"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </Stack>
            )}
            <TextField
              label="Notes"
              fullWidth
              margin="normal"
              multiline
              minRows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              sx={{ mt: 2 }}
              disabled={state.isLoading}
            >
              Request extension
            </Button>
          </Box>
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Button component={Link} to="/login" onClick={() => dispatch(logout())}>
              Sign out
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
