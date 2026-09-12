import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useState } from 'react';
import { useCreateBrandMutation, useGetBrandsQuery, useUpdateBrandMutation } from '../store/api';

export default function SuperadminBrandsPage(): JSX.Element {
  const { data: brands = [], refetch } = useGetBrandsQuery();
  const [createBrand, createState] = useCreateBrandMutation();
  const [updateBrand] = useUpdateBrandMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [paperCapital, setPaperCapital] = useState('10000000');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const onCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await createBrand({
      name,
      domain,
      paperCapital: Number(paperCapital) || 10_000_000,
      adminEmail: adminEmail || undefined,
      adminName: adminName || undefined,
      adminPassword: adminPassword || undefined,
    }).unwrap();
    setOpen(false);
    void refetch();
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Brands</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>
          Create brand
        </Button>
      </Stack>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Domain</TableCell>
            <TableCell>Paper capital</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {brands.map((b) => (
            <TableRow key={b.id}>
              <TableCell>{b.name}</TableCell>
              <TableCell>{b.domain}</TableCell>
              <TableCell>₹{Number(b.paperCapital).toLocaleString('en-IN')}</TableCell>
              <TableCell>{b.status}</TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  onClick={() => {
                    const next = window.prompt('Paper capital (INR)', String(b.paperCapital));
                    if (next == null) return;
                    void updateBrand({ id: b.id, paperCapital: Number(next) });
                  }}
                >
                  Set capital
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    void updateBrand({
                      id: b.id,
                      status: b.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                    })
                  }
                >
                  {b.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create brand + admin</DialogTitle>
        <Box component="form" onSubmit={(e) => void onCreate(e)}>
          <DialogContent>
            {createState.isError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Could not create brand
              </Alert>
            )}
            <TextField
              label="Brand name"
              fullWidth
              margin="normal"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Domain"
              fullWidth
              margin="normal"
              required
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              helperText="Unique, e.g. acme.stockpred.app"
            />
            <TextField
              label="Paper capital"
              type="number"
              fullWidth
              margin="normal"
              value={paperCapital}
              onChange={(e) => setPaperCapital(e.target.value)}
            />
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              First admin (optional)
            </Typography>
            <TextField
              label="Admin name"
              fullWidth
              margin="normal"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
            />
            <TextField
              label="Admin email"
              type="email"
              fullWidth
              margin="normal"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
            <TextField
              label="Admin password"
              type="password"
              fullWidth
              margin="normal"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
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
