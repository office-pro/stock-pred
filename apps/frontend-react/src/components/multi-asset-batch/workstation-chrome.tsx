import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export const PANEL_SX = {
  border: '1px solid rgba(56, 189, 248, 0.28)',
  bgcolor: '#0b1220',
  borderRadius: '12px',
  p: { xs: 1.5, md: 2 },
} as const;

export const KPI_SX = {
  ...PANEL_SX,
  textAlign: 'center' as const,
  py: 2,
  boxShadow: 'inset 0 0 24px rgba(34, 211, 238, 0.08)',
};

export function WorkstationPanel({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <Paper variant="outlined" sx={PANEL_SX} data-testid={testId}>
      {children}
    </Paper>
  );
}

export function QueryState({
  loading,
  error,
  errorMessage,
  onRetry,
  children,
}: {
  loading: boolean;
  error: boolean;
  errorMessage: string;
  onRetry?: () => void;
  children: ReactNode;
}): JSX.Element {
  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" py={6} gap={1}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      </Stack>
    );
  }
  if (error) {
    return (
      <Alert
        severity="error"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {errorMessage}
      </Alert>
    );
  }
  return <>{children}</>;
}

export function WorkstationFooter(): JSX.Element {
  return (
    <Typography variant="caption" color="text.secondary" display="block" mt={3}>
      Backend-owned data only · No frontend ranking/readiness math · Missing data = UNAVAILABLE
    </Typography>
  );
}

export function PageTitle({
  title,
  subtitle,
  breadcrumb,
  actions,
}: {
  title: string;
  subtitle?: string;
  breadcrumb?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      justifyContent="space-between"
      gap={1.5}
      mb={2}
      alignItems={{ md: 'flex-start' }}
    >
      <Box>
        {breadcrumb ? (
          <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
            {breadcrumb}
          </Typography>
        ) : null}
        <Typography variant="h4" fontWeight={800}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {actions ? (
        <Stack direction="row" gap={1} flexWrap="wrap">
          {actions}
        </Stack>
      ) : null}
    </Stack>
  );
}
