import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material';

interface BrokerStatusProps {
  brokerType: string;
  isConnected: boolean;
  accountId?: string;
  availableCash?: number;
  marginMultiplier?: number;
  usedMargin?: number;
}

export const BrokerStatus: React.FC<BrokerStatusProps> = ({
  brokerType,
  isConnected,
  accountId,
  availableCash,
  marginMultiplier = 1,
  usedMargin = 0,
}) => {
  const getBrokerColor = (broker: string) => {
    const colors: Record<string, string> = {
      PAPER: '#2196F3',
      ZERODHA: '#FF9800',
      ANGELONE: '#4CAF50',
      UPSTOX: '#9C27B0',
      SHOONYA: '#F44336',
      FYERS: '#00BCD4',
    };
    return colors[broker] || '#757575';
  };

  const statusColor = isConnected ? 'success' : 'error';
  const statusText = isConnected ? 'Connected' : 'Disconnected';

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6}>
            <Stack spacing={1}>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="subtitle2" color="textSecondary">
                  Active Broker:
                </Typography>
                <Chip
                  label={brokerType}
                  size="small"
                  sx={{
                    backgroundColor: getBrokerColor(brokerType),
                    color: 'white',
                    fontWeight: 'bold',
                  }}
                />
              </Box>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="subtitle2" color="textSecondary">
                  Status:
                </Typography>
                <Chip
                  label={statusText}
                  size="small"
                  color={statusColor}
                  variant="outlined"
                />
              </Box>
            </Stack>
          </Grid>

          <Grid item xs={12} sm={6}>
            <Stack spacing={1}>
              {accountId && (
                <Box>
                  <Typography variant="caption" color="textSecondary">
                    Account ID
                  </Typography>
                  <Typography variant="body2">{accountId}</Typography>
                </Box>
              )}
              {marginMultiplier > 1 && (
                <Box>
                  <Typography variant="caption" color="textSecondary">
                    Leverage
                  </Typography>
                  <Typography variant="body2">{marginMultiplier}x</Typography>
                </Box>
              )}
            </Stack>
          </Grid>

          {availableCash !== undefined && (
            <Grid item xs={12} sm={6}>
              <Box>
                <Typography variant="caption" color="textSecondary">
                  Available Cash
                </Typography>
                <Typography variant="body2">
                  ₹{(availableCash / 100000).toFixed(2)}L
                </Typography>
              </Box>
            </Grid>
          )}

          {usedMargin > 0 && (
            <Grid item xs={12} sm={6}>
              <Box>
                <Typography variant="caption" color="textSecondary">
                  Used Margin
                </Typography>
                <Typography variant="body2">
                  ₹{(usedMargin / 100000).toFixed(2)}L
                </Typography>
              </Box>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
};
