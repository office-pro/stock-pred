import { Alert, Box, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import GroupIcon from '@mui/icons-material/Group';
import ViewListIcon from '@mui/icons-material/ViewList';

const STEPS = [
  {
    icon: <AddIcon fontSize="small" color="primary" />,
    title: 'Create ARTURO',
    body: 'Click + Create to add a new feature flag.',
  },
  {
    icon: <TuneIcon fontSize="small" color="primary" />,
    title: 'Select Release Type',
    body: 'Choose General Availability, Code Beta, or Off.',
  },
  {
    icon: <GroupIcon fontSize="small" color="primary" />,
    title: 'Add Accounts / Comments',
    body: 'Comma-separated brand domains; prefix - to exclude.',
  },
  {
    icon: <ViewListIcon fontSize="small" color="primary" />,
    title: 'View & Manage',
    body: 'Search, toggle local status, and edit flags anytime.',
  },
];

export default function ArturoWorkflowStrip(): JSX.Element {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
        How ARTURO works
      </Typography>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{
          p: 2,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {STEPS.map((step, i) => (
          <Box key={step.title} sx={{ flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              {step.icon}
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {i + 1}. {step.title}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {step.body}
            </Typography>
            {i === 2 ? (
              <Alert severity="info" variant="outlined" sx={{ mt: 1, py: 0 }}>
                <Typography variant="caption">
                  Format Rules: <code>domain</code> includes · <code>-domain</code> excludes
                </Typography>
              </Alert>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
