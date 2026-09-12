import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { authErrorMessage } from '../lib/auth-errors';
import {
  useIngestFundamentalsMutation,
  useIngestMacroMutation,
  useIngestNewsMutation,
  useIngestSocialMutation,
  useLazyGetMlJobQuery,
  useRefreshTechnicalMutation,
  useStartMlJobMutation,
  type MlJobRow,
} from '../store/api';

type IngestKind = 'technical' | 'fundamentals' | 'news' | 'social' | 'macro';
type PipelineKind = IngestKind | 'train' | 'predict';

type StepStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';

interface StepState {
  status: StepStatus;
  detail?: string;
}

const INGEST_STEPS: Array<{ id: IngestKind; label: string }> = [
  { id: 'technical', label: 'Technical' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'news', label: 'News' },
  { id: 'social', label: 'Social' },
  { id: 'macro', label: 'Macro' },
];

const ML_STEPS: Array<{ id: 'train' | 'predict'; label: string }> = [
  { id: 'train', label: 'Train' },
  { id: 'predict', label: 'Predict' },
];

const PIPELINE_STEPS: Array<{ id: PipelineKind; label: string }> = [...INGEST_STEPS, ...ML_STEPS];

const INITIAL: Record<PipelineKind, StepState> = {
  technical: { status: 'idle' },
  fundamentals: { status: 'idle' },
  news: { status: 'idle' },
  social: { status: 'idle' },
  macro: { status: 'idle' },
  train: { status: 'idle' },
  predict: { status: 'idle' },
};

function statusColor(status: StepStatus): 'default' | 'info' | 'success' | 'error' | 'warning' {
  if (status === 'running') return 'info';
  if (status === 'done') return 'success';
  if (status === 'error') return 'error';
  if (status === 'skipped') return 'warning';
  return 'default';
}

function progressFromSteps(steps: Record<PipelineKind, StepState>, running: boolean): number {
  const weight = 100 / PIPELINE_STEPS.length;
  let done = 0;
  let finished = 0;
  for (const step of PIPELINE_STEPS) {
    const status = steps[step.id].status;
    if (status === 'done' || status === 'skipped' || status === 'error') {
      done += weight;
      finished += 1;
    } else if (status === 'running') {
      done += weight * 0.45;
    }
  }
  if (!running && finished === PIPELINE_STEPS.length) return 100;
  return Math.min(100, Math.round(done));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function StockIngestPanel({
  symbol,
  onToast,
  onRefetch,
}: {
  symbol: string;
  onToast?: (message: string, severity: 'success' | 'error' | 'info') => void;
  onRefetch?: () => void;
}): JSX.Element {
  const [steps, setSteps] = useState<Record<PipelineKind, StepState>>(INITIAL);
  const [running, setRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const [refreshTechnical] = useRefreshTechnicalMutation();
  const [ingestFundamentals] = useIngestFundamentalsMutation();
  const [ingestNews] = useIngestNewsMutation();
  const [ingestSocial] = useIngestSocialMutation();
  const [ingestMacro] = useIngestMacroMutation();
  const [startMlJob] = useStartMlJobMutation();
  const [fetchMlJob] = useLazyGetMlJobQuery();

  const progress = progressFromSteps(steps, running);

  const patch = (id: PipelineKind, next: StepState) => {
    setSteps((prev) => ({ ...prev, [id]: next }));
  };

  const waitForJob = async (jobId: string): Promise<MlJobRow> => {
    for (let i = 0; i < 900; i += 1) {
      await sleep(1200);
      const snap = await fetchMlJob().unwrap();
      const job = snap.job;
      if (!job || job.id !== jobId) continue;
      if (job.status === 'running') {
        patch(job.kind === 'predict_all' ? 'predict' : 'train', {
          status: 'running',
          detail: `${job.percent}% · ${job.stage}`,
        });
        continue;
      }
      return job;
    }
    throw new Error('Timed out waiting for ML job');
  };

  const runMl = async (kind: 'train_all' | 'predict_all'): Promise<boolean> => {
    const stepId: PipelineKind = kind === 'train_all' ? 'train' : 'predict';
    patch(stepId, { status: 'running', detail: 'starting…' });
    try {
      const { job } = await startMlJob({
        kind,
        universe: 'all',
        symbols: symbol.toUpperCase(),
      }).unwrap();
      patch(stepId, { status: 'running', detail: `${job.percent}% · ${job.stage}` });
      const finished = await waitForJob(job.id);
      if (finished.status === 'succeeded') {
        patch(stepId, {
          status: 'done',
          detail: finished.stage || 'complete',
        });
        return true;
      }
      const message = finished.error || `${stepId} ${finished.status}`;
      patch(stepId, { status: 'error', detail: message });
      setLastError(message);
      return false;
    } catch (error) {
      const message = authErrorMessage(error, `Failed to ${stepId} ${symbol}`);
      patch(stepId, { status: 'error', detail: message });
      setLastError(message);
      return false;
    }
  };

  const runOne = async (id: IngestKind): Promise<boolean> => {
    patch(id, { status: 'running' });
    try {
      if (id === 'technical') {
        const result = await refreshTechnical(symbol).unwrap();
        patch(id, {
          status: 'done',
          detail: `${result.candles} bars · ${result.dataSource}${result.indicators ? ' · indicators' : ''}`,
        });
        return true;
      }
      if (id === 'fundamentals') {
        const result = await ingestFundamentals({ symbol, full: true }).unwrap();
        if (result.skipped) {
          patch(id, {
            status: 'skipped',
            detail: result.reason ?? 'skipped',
          });
          return true;
        }
        patch(id, {
          status: 'done',
          detail: result.cached
            ? 'cached fresh'
            : `${result.snapshots} snapshot${result.snapshots === 1 ? '' : 's'}`,
        });
        return true;
      }
      if (id === 'news') {
        const result = (await ingestNews({ symbol, full: true }).unwrap()) as {
          snapshots?: number;
          skipped?: boolean;
          reason?: string;
          cached?: boolean;
          sources?: string[];
        };
        if (result?.skipped) {
          patch(id, { status: 'skipped', detail: result.reason ?? 'skipped' });
          return true;
        }
        const src =
          result?.sources && result.sources.length > 0
            ? ` · ${result.sources.slice(0, 4).join(', ')}`
            : '';
        patch(id, {
          status: 'done',
          detail: result?.cached ? 'cached fresh' : `${result.snapshots ?? 0} days${src}`,
        });
        return true;
      }
      if (id === 'social') {
        const result = (await ingestSocial({ symbol, full: true }).unwrap()) as {
          snapshots?: number;
          skipped?: boolean;
          reason?: string;
          cached?: boolean;
          sources?: string[];
        };
        if (result?.skipped) {
          patch(id, { status: 'skipped', detail: result.reason ?? 'skipped' });
          return true;
        }
        const src =
          result?.sources && result.sources.length > 0
            ? ` · ${result.sources.slice(0, 3).join(', ')}`
            : '';
        patch(id, {
          status: 'done',
          detail: result?.cached ? 'cached fresh' : `${result.snapshots ?? 0} days${src}`,
        });
        return true;
      }
      const result = (await ingestMacro({ full: true, includeIndia: true }).unwrap()) as {
        snapshots?: number;
        daily?: number;
        observations?: number;
        skipped?: boolean;
        reason?: string;
        cached?: boolean;
        sources?: string[];
      };
      if (result?.skipped) {
        patch(id, { status: 'skipped', detail: result.reason ?? 'skipped' });
        return true;
      }
      const src =
        result?.sources && result.sources.length > 0 ? ` · ${result.sources.join(', ')}` : '';
      patch(id, {
        status: 'done',
        detail: result?.cached
          ? 'cached fresh'
          : `${result.observations ?? result.daily ?? 0} pts${src}`,
      });
      return true;
    } catch (error) {
      const message = authErrorMessage(error, `Failed to ingest ${id}`);
      patch(id, { status: 'error', detail: message });
      setLastError(message);
      return false;
    }
  };

  const runAll = async () => {
    if (running) return;
    setRunning(true);
    setLastError(null);
    setSteps(INITIAL);
    let ok = 0;
    for (const step of INGEST_STEPS) {
      const success = await runOne(step.id);
      if (success) ok += 1;
    }
    // Train + predict this symbol after data refresh (shared models, scoped to symbol rows).
    if (ok > 0) {
      if (await runMl('train_all')) ok += 1;
      if (await runMl('predict_all')) ok += 1;
    } else {
      patch('train', { status: 'skipped', detail: 'ingest failed' });
      patch('predict', { status: 'skipped', detail: 'ingest failed' });
    }
    setRunning(false);
    onRefetch?.();
    const total = PIPELINE_STEPS.length;
    if (ok === total) {
      onToast?.(`Ingest + train finished for ${symbol}`, 'success');
    } else if (ok > 0) {
      onToast?.(`Pipeline finished with ${total - ok} issue(s) for ${symbol}`, 'info');
    } else {
      onToast?.(`Ingest failed for ${symbol}`, 'error');
    }
  };

  const runSingle = async (id: PipelineKind) => {
    if (running) return;
    setRunning(true);
    setLastError(null);
    patch(id, { status: 'idle' });
    let success = false;
    if (id === 'train') success = await runMl('train_all');
    else if (id === 'predict') success = await runMl('predict_all');
    else success = await runOne(id);
    setRunning(false);
    onRefetch?.();
    if (success) onToast?.(`${id} done for ${symbol}`, 'success');
    else onToast?.(`${id} failed for ${symbol}`, 'error');
  };

  return (
    <Card variant="outlined" data-testid="stock-ingest-panel">
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          sx={{ mb: 1.5 }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              Data ingest & train
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Pull fresh technical, fundamentals, news, social, and macro for {symbol}, then train
              direction models on this symbol and refresh predictions. News searches Google / India
              press / Yahoo / GDELT; social searches Reddit + StockTwits; macro is market-wide.
            </Typography>
          </Box>
          <Button variant="contained" onClick={() => void runAll()} disabled={running}>
            {running ? 'Running…' : 'Ingest & train'}
          </Button>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 52 }}>
            {progress}%
          </Typography>
          <Box sx={{ flex: 1 }}>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{ height: 8, borderRadius: 1 }}
            />
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5, mb: 1 }}>
          {PIPELINE_STEPS.map((step) => {
            const state = steps[step.id];
            return (
              <Chip
                key={step.id}
                size="small"
                color={statusColor(state.status)}
                variant={state.status === 'idle' ? 'outlined' : 'filled'}
                label={
                  state.detail
                    ? `${step.label}: ${state.status === 'running' ? '…' : state.detail}`
                    : `${step.label}: ${state.status}`
                }
                onClick={running ? undefined : () => void runSingle(step.id)}
                disabled={running}
                sx={{ cursor: running ? 'default' : 'pointer' }}
              />
            );
          })}
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block">
          Click a chip to run that step alone. Train/Predict are scoped to {symbol} (shared model
          artifacts). If another ML Lab job is running, wait for it to finish first.
        </Typography>

        {lastError && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {lastError}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
