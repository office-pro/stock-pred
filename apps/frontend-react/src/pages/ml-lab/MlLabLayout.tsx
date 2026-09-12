import { Alert, Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';

const TABS = [
  { label: 'Overview', to: '/ml-lab', end: true },
  { label: 'Datasets', to: '/ml-lab/dataset' },
  { label: 'Training', to: '/ml-lab/jobs' },
  { label: 'Validation', to: '/ml-lab/validation' },
  { label: 'Testing', to: '/ml-lab/ingestion' },
  { label: 'Models', to: '/ml-lab/registry' },
  { label: 'Predictions', to: '/ml-lab/predictions' },
  { label: 'Model Health', to: '/ml-lab/monitoring' },
  { label: 'TI Bridge', to: '/ml-lab/ti-bridge' },
  { label: 'Reports', to: '/ml-lab/reports' },
] as const;

function tabIndex(pathname: string): number {
  if (pathname.startsWith('/ml-lab/dataset')) return 1;
  if (pathname.startsWith('/ml-lab/jobs')) return 2;
  if (pathname.startsWith('/ml-lab/validation')) return 3;
  if (pathname.startsWith('/ml-lab/ingestion')) return 4;
  if (pathname.startsWith('/ml-lab/registry')) return 5;
  if (pathname.startsWith('/ml-lab/predictions')) return 6;
  if (pathname.startsWith('/ml-lab/monitoring')) return 7;
  if (pathname.startsWith('/ml-lab/ti-bridge')) return 8;
  if (pathname.startsWith('/ml-lab/reports')) return 9;
  return 0;
}

/** Shared chrome for ML Center — existing lifecycle routes, renamed IA only. */
export default function MlLabLayout(): JSX.Element {
  const { pathname } = useLocation();
  const value = tabIndex(pathname);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        ML Center
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
        Lifecycle visibility (datasets → train → validate → models → predictions → health). Does not
        train in the browser and never authorizes trades.
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>Train → CANDIDATE only.</strong> <strong>Promote → ACTIVE</strong> only after
        server-side gates. ML Center never authorizes BUY/SELL (Risk → Portfolio → Policy → Gate).
      </Alert>
      <Stack spacing={2}>
        <Tabs value={value} variant="scrollable" allowScrollButtonsMobile>
          {TABS.map((tab) => (
            <Tab
              key={tab.to}
              label={tab.label}
              component={RouterLink}
              to={tab.to}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            />
          ))}
        </Tabs>
        <Outlet />
      </Stack>
    </Box>
  );
}
