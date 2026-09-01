import { Alert, Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';

const TABS = [
  { label: 'Overview', to: '/ml-lab', end: true },
  { label: 'Ingestion', to: '/ml-lab/ingestion' },
  { label: 'Dataset', to: '/ml-lab/dataset' },
  { label: 'Validation', to: '/ml-lab/validation' },
  { label: 'Predictions', to: '/ml-lab/predictions' },
  { label: 'Monitoring', to: '/ml-lab/monitoring' },
  { label: 'TI Bridge', to: '/ml-lab/ti-bridge' },
  { label: 'Reports', to: '/ml-lab/reports' },
  { label: 'Registry', to: '/ml-lab/registry' },
  { label: 'Jobs', to: '/ml-lab/jobs' },
] as const;

function tabIndex(pathname: string): number {
  if (pathname.startsWith('/ml-lab/ingestion')) return 1;
  if (pathname.startsWith('/ml-lab/dataset')) return 2;
  if (pathname.startsWith('/ml-lab/validation')) return 3;
  if (pathname.startsWith('/ml-lab/predictions')) return 4;
  if (pathname.startsWith('/ml-lab/monitoring')) return 5;
  if (pathname.startsWith('/ml-lab/ti-bridge')) return 6;
  if (pathname.startsWith('/ml-lab/reports')) return 7;
  if (pathname.startsWith('/ml-lab/registry')) return 8;
  if (pathname.startsWith('/ml-lab/jobs')) return 9;
  return 0;
}

/** Shared chrome for ML Lab — Phase 1–5 tabs. */
export default function MlLabLayout(): JSX.Element {
  const { pathname } = useLocation();
  const value = tabIndex(pathname);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        ML Lab
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
        Control center for the ML lifecycle (ingest → train → validate → promote → predict → monitor
        → reports). Orchestrates the existing ml-engine — it does not train in the browser and does
        not place trades.
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>Train → CANDIDATE only.</strong> <strong>Promote → ACTIVE</strong> only after
        server-side gates. Reports / predictions / drift feed Trade Intelligence only — ML Lab never
        authorizes BUY/SELL (Risk → Portfolio → Policy → Gate).
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
