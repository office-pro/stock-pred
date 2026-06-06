import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Container,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';

interface BrokerConfig {
  brokerType: 'PAPER' | 'ZERODHA' | 'ANGELONE' | 'UPSTOX' | 'SHOONYA' | 'FYERS';
  credentials?: Record<string, string>;
}

const BROKER_CONFIGS: Record<string, { fields: string[]; description: string }> = {
  PAPER: {
    fields: [],
    description: 'Paper trading - no credentials needed',
  },
  ZERODHA: {
    fields: ['clientId', 'clientSecret'],
    description: 'Zerodha Kite - OAuth authentication',
  },
  ANGELONE: {
    fields: ['apiKey'],
    description: 'AngelOne - API key authentication',
  },
  UPSTOX: {
    fields: ['apiKey'],
    description: 'Upstox - OAuth authentication',
  },
  SHOONYA: {
    fields: ['apiKey', 'userId'],
    description: 'Shoonya - API key authentication',
  },
  FYERS: {
    fields: ['apiKey'],
    description: 'Fyers - API key authentication',
  },
};

export const BrokerConfigPage: React.FC = () => {
  const [brokerType, setBrokerType] = useState<BrokerConfig['brokerType']>('PAPER');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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
    setLoading(true);
    try {
      const response = await fetch('/api/brokers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brokerType,
          credentials: selectedBrokerConfig.fields.length > 0 ? credentials : undefined,
        }),
      });

      if (!response.ok) throw new Error('Failed to save broker config');

      setMessage({
        type: 'success',
        text: `${brokerType} broker configured successfully`,
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Configuration failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/brokers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brokerType }),
      });

      if (!response.ok) throw new Error('Connection test failed');

      setMessage({
        type: 'success',
        text: `Successfully connected to ${brokerType}`,
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Connection test failed',
      });
    } finally {
      setLoading(false);
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
                onClick={handleSave}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={20} /> : undefined}
              >
                Save Configuration
              </Button>
              <Button variant="outlined" onClick={handleTest} disabled={loading}>
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
                <br />✓ Perfect for testing
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
