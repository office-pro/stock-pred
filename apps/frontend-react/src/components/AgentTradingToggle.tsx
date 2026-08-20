import { Box, FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { authErrorMessage } from '../lib/auth-errors';
import { useGetAgentModeQuery, useSetAgentTradingEnabledMutation } from '../store/api';

type Props = {
  /** Compact single-line layout for dashboard header. */
  compact?: boolean;
};

export default function AgentTradingToggle({ compact = false }: Props): JSX.Element {
  const {
    data: modeData,
    refetch,
    error: modeError,
  } = useGetAgentModeQuery(undefined, {
    pollingInterval: 15_000,
  });
  const [setTradingEnabled, { isLoading }] = useSetAgentTradingEnabledMutation();
  const [error, setError] = useState<string | null>(null);

  const tradingOn = Boolean(modeData?.tradingEnabled);
  const agentDown =
    modeError &&
    typeof modeError === 'object' &&
    'status' in modeError &&
    (modeError.status === 502 || modeError.status === 503 || modeError.status === 404);

  const control = (
    <FormControlLabel
      sx={compact ? { mr: 0, alignItems: 'center' } : undefined}
      control={
        <Switch
          color="primary"
          size={compact ? 'small' : 'medium'}
          checked={tradingOn}
          disabled={isLoading || Boolean(agentDown)}
          onChange={async (_e, checked) => {
            setError(null);
            try {
              await setTradingEnabled({ enabled: checked }).unwrap();
              await refetch();
            } catch (err) {
              const status =
                err && typeof err === 'object' && 'status' in err
                  ? (err as { status?: number | string }).status
                  : undefined;
              if (status === 502 || status === 503 || status === 404) {
                setError('Trader agent is offline — restart api-gateway and trader-agent (:3008).');
              } else if (status === 401) {
                setError('Session expired — log out and log in again, then retry.');
              } else {
                setError(
                  authErrorMessage(
                    err,
                    'Could not update agent trading. Check trader-agent on :3008.',
                  ),
                );
              }
            }
          }}
        />
      }
      label={
        compact ? (
          <Typography variant="body2" fontWeight={600}>
            Enable AI agent trading
          </Typography>
        ) : (
          <Box>
            <Typography fontWeight={700}>Enable AI agent trading</Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Off by default. Turn on only when you want the agent to approve buys and manage exits.{' '}
              <Typography
                component={RouterLink}
                to="/agent"
                variant="caption"
                sx={{ color: 'primary.main' }}
              >
                Open Agent desk
              </Typography>
            </Typography>
          </Box>
        )
      }
    />
  );

  const statusHint = agentDown
    ? 'Trader agent service is offline — start it (port 3008) then retry.'
    : error;

  if (compact) {
    return (
      <Paper
        variant="outlined"
        sx={{
          px: 1.5,
          py: 0.5,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
        }}
        data-testid="agent-trading-toggle"
      >
        {control}
        {statusHint && (
          <Typography variant="caption" color="error">
            {statusHint}
          </Typography>
        )}
        {tradingOn && !agentDown && (
          <Typography
            component={RouterLink}
            to="/agent"
            variant="caption"
            sx={{ color: 'primary.main', whiteSpace: 'nowrap' }}
          >
            Agent desk
          </Typography>
        )}
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="agent-trading-toggle">
      {control}
      {statusHint && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
          {statusHint}
        </Typography>
      )}
    </Paper>
  );
}
