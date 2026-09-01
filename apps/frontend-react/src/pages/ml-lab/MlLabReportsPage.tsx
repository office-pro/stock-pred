import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  type MlReportCatalogItem,
  useGetMlReportsQuery,
  useGetMlTiBridgeQuery,
} from '../../store/api';

function presenceChip(item: MlReportCatalogItem, tiUsable?: number | null): JSX.Element {
  if (item.id === 'tiBridge' && tiUsable != null) {
    return (
      <Chip
        size="small"
        color={tiUsable > 0 ? 'success' : 'warning'}
        label={tiUsable > 0 ? `${tiUsable} TI-usable` : '0 TI-usable'}
      />
    );
  }
  if (item.present === true) {
    return <Chip size="small" color="success" label="Present" />;
  }
  if (item.present === false) {
    return <Chip size="small" color="default" label="Missing" />;
  }
  return <Chip size="small" variant="outlined" label="External (MDS)" />;
}

/** Phase 5: hub over existing M2–M4 report artifacts — no new report generation. */
export default function MlLabReportsPage(): JSX.Element {
  const { data, isLoading, isError } = useGetMlReportsQuery(undefined, {
    pollingInterval: 30_000,
  });
  const { data: ti } = useGetMlTiBridgeQuery(undefined, { pollingInterval: 30_000 });

  if (isLoading && !data) {
    return <Typography color="text.secondary">Loading reports catalog…</Typography>;
  }

  if (isError) {
    return (
      <Alert severity="error">
        Could not load <code>/ml/reports</code>. Is ml-engine running?
      </Alert>
    );
  }

  const counts = data?.counts;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Reports hub indexes existing ML artifacts from Phases 1–4. It does not generate new reports,
        retrain models, or authorize trades — open each card for the read-only detail view.
      </Typography>

      <Alert severity="info" variant="outlined">
        All reports are <strong>advisory for ML / Trade Intelligence only</strong>. They never enter
        Risk → Portfolio → Policy → Gate.
      </Alert>

      {data?.note ? (
        <Alert severity="success" variant="outlined">
          {data.note}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" color="success" label={`Present ${counts?.present ?? 0}`} />
        <Chip size="small" label={`Missing ${counts?.missing ?? 0}`} />
        <Chip size="small" variant="outlined" label={`External ${counts?.external ?? 0}`} />
        <Chip size="small" variant="outlined" label={`Total ${counts?.total ?? 0}`} />
        {ti != null ? (
          <Chip
            size="small"
            color={ti.usable > 0 ? 'success' : 'default'}
            label={`TI usable ${ti.usable}/${ti.total}`}
          />
        ) : null}
      </Stack>

      <Grid container spacing={2}>
        {(data?.reports ?? []).map((item) => (
          <Grid item xs={12} sm={6} md={4} key={item.id}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardActionArea
                component={RouterLink}
                to={item.labPath}
                sx={{ height: '100%', alignItems: 'stretch' }}
              >
                <CardContent>
                  <Stack spacing={1}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Typography variant="subtitle1" fontWeight={700}>
                        {item.title}
                      </Typography>
                      <Chip size="small" variant="outlined" label={item.phase} />
                      {presenceChip(item, item.id === 'tiBridge' ? ti?.usable : null)}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {item.blurb}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      Artifact: <code>{item.artifact}</code>
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      Open {item.labPath.replace('/ml-lab/', '')} →
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Typography variant="caption" color="text.secondary">
        Missing artifacts appear after the related Jobs (train / walk-forward / predict / score)
        complete. See{' '}
        <Box component={RouterLink} to="/ml-lab/jobs" sx={{ fontWeight: 600 }}>
          Jobs
        </Box>
        .
      </Typography>
    </Stack>
  );
}
