import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { authErrorMessage } from '../lib/auth-errors';
import {
  useAckAgentSuggestionMutation,
  useGetAgentSuggestionsQuery,
  useImplementAgentSuggestionMutation,
} from '../store/api';

const priorityColor = (priority: string): 'default' | 'warning' | 'error' | 'info' => {
  if (priority === 'blocker') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'default';
};

const statusLabel = (status: string): string => {
  switch (status) {
    case 'open':
      return 'Open';
    case 'acknowledged':
      return 'Acknowledged';
    case 'implementing':
      return 'Implementing…';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
};

export default function AgentSuggestionCards({
  onToast,
}: {
  onToast?: (message: string) => void;
}): JSX.Element {
  const { data, isFetching, refetch } = useGetAgentSuggestionsQuery(undefined, {
    pollingInterval: 3_000,
  });
  const [ack, ackState] = useAckAgentSuggestionMutation();
  const [implement, implementState] = useImplementAgentSuggestionMutation();

  const suggestions = data?.suggestions ?? [];
  const active = suggestions.filter(
    (row) => row.status !== 'acknowledged' && row.status !== 'completed',
  );
  const acknowledged = suggestions.filter((row) => row.status === 'acknowledged');
  const anyImplementing = active.some((row) => row.status === 'implementing');

  return (
    <Box sx={{ mb: 3 }} data-testid="agent-suggestion-cards">
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Typography variant="subtitle1" fontWeight={700}>
          Capability suggestions
        </Typography>
        <Button size="small" variant="outlined" onClick={() => refetch()} disabled={isFetching}>
          Refresh
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        These cards are retained across restarts. <b>Implement</b> launches a Cursor agent on this
        repo (full project context) when <code>CURSOR_API_KEY</code> is set. Live progress streams
        into the card while the agent builds.
      </Typography>

      {data && !data.cursorSdk.configured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Set <code>CURSOR_API_KEY</code> in <code>.env</code> and restart trader-agent to run
          Implement via Cursor SDK.
        </Alert>
      )}

      {anyImplementing && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Cursor is building — progress updates every few seconds below.
        </Alert>
      )}

      {active.length === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>
          No open capability gaps right now.
        </Alert>
      )}

      <Stack spacing={1.5}>
        {active.map((card) => (
          <Card key={card.id} variant="outlined">
            {card.status === 'implementing' && <LinearProgress />}
            <CardContent sx={{ pb: 1 }}>
              <Stack
                direction="row"
                spacing={1}
                alignItems={{ sm: 'center' }}
                flexWrap="wrap"
                sx={{ mb: 1 }}
              >
                <Typography fontWeight={700}>{card.title}</Typography>
                <Chip size="small" label={card.priority} color={priorityColor(card.priority)} />
                <Chip size="small" variant="outlined" label={statusLabel(card.status)} />
                <Chip size="small" label={card.suggestedOwner} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {card.whyNeeded}
              </Typography>
              {card.taskBriefPath && (
                <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                  Brief: <code>{card.taskBriefPath}</code>
                </Typography>
              )}
              {(card.cursorAgentId || card.cursorRunId) && (
                <Typography variant="caption" display="block" color="text.secondary">
                  {card.cursorAgentId && (
                    <>
                      agent <code>{card.cursorAgentId}</code>{' '}
                    </>
                  )}
                  {card.cursorRunId && (
                    <>
                      run <code>{card.cursorRunId}</code>
                    </>
                  )}
                </Typography>
              )}
              {card.resultSummary && card.status !== 'implementing' && (
                <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                  {card.resultSummary}
                </Typography>
              )}
              {card.lastError && (
                <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                  {card.lastError}
                </Typography>
              )}
              {(card.progressLog?.length || card.status === 'implementing') && (
                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.25,
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: 12,
                    maxHeight: 220,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                  data-testid={`agent-progress-${card.id}`}
                >
                  <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5 }}>
                    Build progress
                  </Typography>
                  {(card.progressLog && card.progressLog.length > 0
                    ? card.progressLog
                    : ['Waiting for Cursor stream…']
                  ).map((line, index) => (
                    <Box key={`${card.id}-log-${index}`} component="div">
                      {line}
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
            <CardActions sx={{ px: 2, pb: 1.5 }}>
              <Button
                size="small"
                variant="contained"
                disabled={implementState.isLoading || card.status === 'implementing'}
                onClick={async () => {
                  try {
                    const result = await implement({ id: card.id }).unwrap();
                    onToast?.(
                      result.resultSummary ||
                        (result.taskBriefPath
                          ? `Implement started — brief at ${result.taskBriefPath}`
                          : `Implement started for ${card.title}`),
                    );
                    await refetch();
                  } catch (error) {
                    onToast?.(authErrorMessage(error, `Could not implement ${card.title}`));
                  }
                }}
              >
                {card.status === 'implementing' ? 'Working…' : 'Implement'}
              </Button>
              <Button
                size="small"
                disabled={ackState.isLoading || card.status === 'implementing'}
                onClick={async () => {
                  try {
                    await ack({ id: card.id }).unwrap();
                    onToast?.(`Acknowledged: ${card.title}`);
                    await refetch();
                  } catch (error) {
                    onToast?.(authErrorMessage(error, `Could not acknowledge ${card.title}`));
                  }
                }}
              >
                Ack
              </Button>
            </CardActions>
          </Card>
        ))}
      </Stack>

      {acknowledged.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Acknowledged ({acknowledged.length}) — retained, hidden from active queue
          </Typography>
        </Box>
      )}
    </Box>
  );
}
