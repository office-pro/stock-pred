import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { UserRole } from '@stockpred/shared-types';
import { useGetBrandQuery, useUpdateBrandMutation } from '../store/api';
import { useAppSelector } from '../store';

export default function BrandSettingsPage(): JSX.Element {
  const me = useAppSelector((s) => s.auth.user);
  const brandId = me?.brandId;
  const isSuper = me?.role === UserRole.SUPERADMIN;
  const { data: brand } = useGetBrandQuery(brandId!, { skip: !brandId });
  const [updateBrand, state] = useUpdateBrandMutation();

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!brand) return;
    setName(brand.name);
    setDomain(brand.domain);
    setContactEmail(brand.contactEmail ?? '');
    setContactPhone(brand.contactPhone ?? '');
    setNotes(brand.notes ?? '');
  }, [brand]);

  if (!brandId) {
    return <Alert severity="info">No brand linked to this account.</Alert>;
  }

  const onSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await updateBrand({
      id: brandId,
      ...(isSuper ? { name, domain } : {}),
      contactEmail,
      contactPhone,
      notes,
    }).unwrap();
  };

  return (
    <Box component="form" onSubmit={(e) => void onSave(e)} sx={{ maxWidth: 520 }}>
      <Typography variant="h5" gutterBottom>
        Brand settings
      </Typography>
      {state.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Saved
        </Alert>
      )}
      <TextField
        label="Name"
        fullWidth
        margin="normal"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={!isSuper}
        helperText={!isSuper ? 'Only superadmin can change brand name' : undefined}
      />
      <TextField
        label="Domain"
        fullWidth
        margin="normal"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        disabled={!isSuper}
        helperText={!isSuper ? 'Only superadmin can change domain' : undefined}
      />
      <TextField
        label="Contact email"
        fullWidth
        margin="normal"
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
      />
      <TextField
        label="Contact phone"
        fullWidth
        margin="normal"
        value={contactPhone}
        onChange={(e) => setContactPhone(e.target.value)}
      />
      <TextField
        label="Notes"
        fullWidth
        margin="normal"
        multiline
        minRows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button type="submit" variant="contained" disabled={state.isLoading}>
          Save
        </Button>
      </Stack>
    </Box>
  );
}
