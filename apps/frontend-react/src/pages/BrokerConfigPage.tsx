import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Container,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { authErrorMessage } from '../lib/auth-errors';
import {
  useConfigureBrokerMutation,
  useNotifyAgentBrokerReadyMutation,
  useTestBrokerConnectionMutation,
} from '../store/api';

interface BrokerConfig {
  brokerType: 'PAPER' | 'ZERODHA' | 'ANGELONE' | 'UPSTOX' | 'SHOONYA' | 'FYERS';
  credentials?: Record<string, string>;
}

const BROKER_CONFIGS: Record<string, { fields: string[]; description: string }> = {
  PAPER: {
    fields: [],
    description: 'Paper trading — no credentials needed. This is the default.',
  },
  ZERODHA: {
    fields: ['clientId', 'clientSecret'],
    description: 'Zerodha Kite - OAuth authentication (live trading only)',
  },
  ANGELONE: {
    fields: ['apiKey'],
    description: 'AngelOne - API key authentication (live trading only)',
  },
  UPSTOX: {
    fields: ['apiKey'],
    description: 'Upstox - OAuth authentication (live trading only)',
  },
  SHOONYA: {
    fields: ['apiKey', 'userId'],
    description: 'Shoonya - API key authentication (live trading only)',
  },
  FYERS: {
    fields: ['apiKey'],
    description: 'Fyers - API key authentication (live trading only)',
  },
};

export const BrokerConfigPage: React.FC = () => {
  const [brokerType, setBrokerType] = useState<BrokerConfig['brokerType']>('PAPER');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [configureBroker, { isLoading: saving }] = useConfigureBrokerMutation();
  const [testBroker, { isLoading: testing }] = useTestBrokerConnectionMutation();
  const [notifyAgent] = useNotifyAgentBrokerReadyMutation();
  const loading = saving || testing;

  const selectedBrokerConfig = BROKER_CONFIGS[brokerType];
  const fieldLabels: Record<string, string> = {
    clientId: 'Client ID',
    clientSecret: 'Client Secret',
    apiKey: 'API Key',
    userId: 'User ID',
  };

  const handleBrokerChange = (e: { target: { value: string } }) => {
    const newBroker = e.target.value as BrokerConfig['brokerType'];
    setBrokerType(newBroker);
    setCredentials({});
    setMessage(null);
  };

  const handleCredentialChange = (field: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
      const result = await configureBroker({
        brokerType,
        credentials: selectedBrokerConfig.fields.length > 0 ? credentials : undefined,
      }).unwrap();
      await notifyAgent({
        configured: true,
        testOk: brokerType === 'PAPER' ? true : undefined,
      }).catch(() => undefined);
      setMessage({
        type: 'success',
        text:
          result.message ||
          (brokerType === 'PAPER'
            ? 'Paper trading is enabled. No broker login required.'
            : `${brokerType} broker configured successfully`),
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: authErrorMessage(error, 'Failed to save broker config'),
      });
    }
  };

  const handleTest = async () => {
    try {
      const result = await testBroker({ brokerType }).unwrap();
      await notifyAgent({ configured: true, testOk: true }).catch(() => undefined);
      setMessage({
        type: 'success',
        text: result.message || `Successfully connected to ${brokerType}`,
      });
    } catch (error) {
      await notifyAgent({ configured: true, testOk: false }).catch(() => undefined);
      setMessage({
        type: 'error',
        text: authErrorMessage(error, 'Connection test failed'),
      });
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Broker Configuration
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardHeader title="Select Broker" />
        <CardContent>
          <Stack spacing={3}>
            <FormControl fullWidth>
              <InputLabel>Broker</InputLabel>
              <Select value={brokerType} label="Broker" onChange={handleBrokerChange}>
                {Object.entries(BROKER_CONFIGS).map(([key, config]) => (
                  <MenuItem key={key} value={key}>
                    {key} - {config.description}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Alert severity="info">{selectedBrokerConfig.description}</Alert>

            {selectedBrokerConfig.fields.length > 0 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Credentials
                </Typography>
                <Grid container spacing={2}>
                  {selectedBrokerConfig.fields.map((field) => (
                    <Grid item xs={12} sm={6} key={field}>
                      <TextField
                        fullWidth
                        label={fieldLabels[field] || field}
                        type={field.includes('Secret') ? 'password' : 'text'}
                        value={credentials[field] || ''}
                        onChange={(e) => handleCredentialChange(field, e.target.value)}
                        placeholder={`Enter ${fieldLabels[field] || field}`}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}

            {message && <Alert severity={message.type}>{message.text}</Alert>}

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={() => void handleSave()}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={20} /> : undefined}
              >
                Save Configuration
              </Button>
              <Button variant="outlined" onClick={() => void handleTest()} disabled={loading}>
                Test Connection
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Broker Features" />
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" gutterBottom>
                Paper Trading (PAPER)
              </Typography>
              <Typography variant="body2" color="textSecondary">
                ✓ Default broker
                <br />✓ No setup required
                <br />✓ 1M INR capital
                <br />✓ Perfect for testing alerts
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" gutterBottom>
                Real Brokers
              </Typography>
              <Typography variant="body2" color="textSecondary">
                ✓ ZERODHA: 4x leverage
                <br />✓ ANGELONE: 5x leverage
                <br />✓ UPSTOX: 3x leverage
                <br />✓ SHOONYA: 2x leverage
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Container>
  );
};
