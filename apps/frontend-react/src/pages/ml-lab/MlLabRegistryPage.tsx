import {
  Alert,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import {
  type MlRegistryModel,
  useGetMlRegistryQuery,
  usePromoteMlModelMutation,
} from '../../store/api';

function statusColor(status: string): 'success' | 'warning' | 'default' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'CANDIDATE') return 'warning';
  return 'default';
}

function promoteErrorMessage(error: unknown): string {
  const data = (error as { data?: { detail?: unknown; message?: string } })?.data;
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: string }).message);
  }
  if (typeof data?.message === 'string') return data.message;
  return 'Promote failed — server gates rejected the candidate.';
}

export default function MlLabRegistryPage(): JSX.Element {
  const { data, isLoading, isError, refetch } = useGetMlRegistryQuery();
  const [promote, promoteState] = usePromoteMlModelMutation();
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);

  const models = data?.models ?? [];

  const onPromote = async (row: MlRegistryModel) => {
    setLastError(null);
    setLastOk(null);
    try {
      const result = await promote({ horizon: row.horizon, modelId: row.modelId }).unwrap();
      setLastOk(result.message || `Promoted ${row.modelId} to ACTIVE.`);
      void refetch();
    } catch (error) {
      setLastError(promoteErrorMessage(error));
    }
  };

  if (isLoading && !data) {
    return <Typography color="text.secondary">Loading registry…</Typography>;
  }

  if (isError) {
    return <Alert severity="error">Could not load model registry.</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Training always registers <strong>CANDIDATE</strong>. Only <strong>Promote</strong> (server
        gates) can make a model <strong>ACTIVE</strong>. The UI never decides eligibility.
      </Typography>

      {lastOk ? <Alert severity="success">{lastOk}</Alert> : null}
      {lastError ? <Alert severity="error">{lastError}</Alert> : null}

      <Paper variant="outlined" sx={{ overflow: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Horizon</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Feature / Dataset</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {models.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No models registered yet. Run <strong>Train</strong> from Jobs — it creates
                    candidates only.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              models.map((row) => (
                <TableRow key={row.modelId} hover>
                  <TableCell>{row.horizon}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.modelVersion}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.modelId.slice(0, 8)}…
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={statusColor(row.status)} label={row.status} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" display="block">
                      {row.featureVersion}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.datasetVersion}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {row.status === 'CANDIDATE' ? (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={promoteState.isLoading}
                        onClick={() => void onPromote(row)}
                      >
                        Promote
                      </Button>
                    ) : row.status === 'ACTIVE' ? (
                      <Typography variant="caption" color="success.main">
                        Serving
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
