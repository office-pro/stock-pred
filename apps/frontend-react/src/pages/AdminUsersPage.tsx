import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useMemo, useState } from 'react';
import { ALL_ASSIGNABLE_VIEWS, AppView, UserRole, UserStatus } from '@stockpred/shared-types';
import {
  useCreateUserMutation,
  useDeleteUserMutation,
  useGetAuthUsersQuery,
  useGetBrandsQuery,
  useGetExtensionsQuery,
  useReviewExtensionMutation,
  useUpdateUserMutation,
} from '../store/api';
import { useAppSelector } from '../store';

function expiryFromPreset(preset: string): string {
  const now = Date.now();
  const map: Record<string, number> = {
    '1h': 3_600_000,
    '2h': 7_200_000,
    '1d': 86_400_000,
    '2d': 172_800_000,
    '7d': 604_800_000,
  };
  return new Date(now + (map[preset] ?? 7_200_000)).toISOString();
}

export default function AdminUsersPage(): JSX.Element {
  const me = useAppSelector((s) => s.auth.user);
  const { data: users = [], refetch } = useGetAuthUsersQuery();
  const { data: extensions = [] } = useGetExtensionsQuery();
  const [createUser, createState] = useCreateUserMutation();
  const [updateUser] = useUpdateUserMutation();
  const [deleteUser] = useDeleteUserMutation();
  const [reviewExtension] = useReviewExtensionMutation();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.USER);
  const [views, setViews] = useState<AppView[]>([...ALL_ASSIGNABLE_VIEWS]);
  const [preset, setPreset] = useState('2h');
  const [brandId, setBrandId] = useState(me?.brandId ?? '');
  const { data: brands = [] } = useGetBrandsQuery(undefined, {
    skip: me?.role !== UserRole.SUPERADMIN,
  });

  const pending = useMemo(() => extensions.filter((e) => e.status === 'PENDING'), [extensions]);

  const toggleView = (view: AppView): void => {
    setViews((prev) => (prev.includes(view) ? prev.filter((v) => v !== view) : [...prev, view]));
  };

  const onCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await createUser({
      email,
      name,
      password,
      role,
      allowedViews: views,
      accessExpiresAt: role === UserRole.VIEWER ? expiryFromPreset(preset) : undefined,
      brandId: me?.role === UserRole.SUPERADMIN ? brandId || undefined : (me?.brandId ?? undefined),
    }).unwrap();
    setOpen(false);
    setEmail('');
    setName('');
    setPassword('');
    void refetch();
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Users</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>
          Add user
        </Button>
      </Stack>

      {pending.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            Viewer extension requests
          </Typography>
          {pending.map((req) => (
            <Alert
              key={req.id}
              severity="info"
              sx={{ mb: 1 }}
              action={
                <Stack direction="row" spacing={1}>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => void reviewExtension({ id: req.id, decision: 'APPROVED' })}
                  >
                    Approve
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => void reviewExtension({ id: req.id, decision: 'DENIED' })}
                  >
                    Deny
                  </Button>
                </Stack>
              }
            >
              {req.viewerName || req.viewerEmail} → until{' '}
              {new Date(req.requestedUntil).toLocaleString()}
            </Alert>
          ))}
        </Box>
      )}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Role</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Views</TableCell>
            <TableCell>Expires</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.name}</TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>{u.role}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={u.status}
                  color={u.status === 'ACTIVE' ? 'success' : 'default'}
                />
              </TableCell>
              <TableCell>{u.allowedViews?.length ?? 0}</TableCell>
              <TableCell>
                {u.accessExpiresAt ? new Date(u.accessExpiresAt).toLocaleString() : '—'}
              </TableCell>
              <TableCell align="right">
                {u.id !== me?.id && u.role !== UserRole.SUPERADMIN && (
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button
                      size="small"
                      onClick={() =>
                        void updateUser({
                          id: u.id,
                          status:
                            u.status === UserStatus.SUSPENDED
                              ? UserStatus.ACTIVE
                              : UserStatus.SUSPENDED,
                        })
                      }
                    >
                      {u.status === UserStatus.SUSPENDED ? 'Unsuspend' : 'Suspend'}
                    </Button>
                    <Button size="small" color="error" onClick={() => void deleteUser(u.id)}>
                      Delete
                    </Button>
                  </Stack>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create user</DialogTitle>
        <Box component="form" onSubmit={(e) => void onCreate(e)}>
          <DialogContent>
            {createState.isError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Could not create user
              </Alert>
            )}
            <TextField
              label="Name"
              fullWidth
              margin="normal"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Email"
              type="email"
              fullWidth
              margin="normal"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Temp password"
              type="password"
              fullWidth
              margin="normal"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="Min 10 chars with upper, lower, digit"
            />
            <TextField
              select
              label="Role"
              fullWidth
              margin="normal"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {me?.role === UserRole.SUPERADMIN && (
                <MenuItem value={UserRole.ADMIN}>ADMIN</MenuItem>
              )}
              <MenuItem value={UserRole.USER}>USER</MenuItem>
              <MenuItem value={UserRole.VIEWER}>VIEWER</MenuItem>
            </TextField>
            {me?.role === UserRole.SUPERADMIN && (
              <TextField
                select
                label="Brand"
                fullWidth
                margin="normal"
                required
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
              >
                {brands.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {role === UserRole.VIEWER && (
              <TextField
                select
                label="Demo duration"
                fullWidth
                margin="normal"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
              >
                <MenuItem value="1h">1 hour</MenuItem>
                <MenuItem value="2h">2 hours</MenuItem>
                <MenuItem value="1d">1 day</MenuItem>
                <MenuItem value="2d">2 days</MenuItem>
                <MenuItem value="7d">1 week</MenuItem>
              </TextField>
            )}
            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              Allowed views
            </Typography>
            <FormGroup>
              {ALL_ASSIGNABLE_VIEWS.map((view) => (
                <FormControlLabel
                  key={view}
                  control={
                    <Checkbox checked={views.includes(view)} onChange={() => toggleView(view)} />
                  }
                  label={view}
                />
              ))}
            </FormGroup>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createState.isLoading}>
              Create
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
