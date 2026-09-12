import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authErrorMessage } from '../lib/auth-errors';
import { useAppDispatch } from '../store';
import { useLoginMutation } from '../store/api';
import { setCredentials } from '../store/authSlice';

export default function LoginPage(): JSX.Element {
  const [email, setEmail] = useState('user@stockpred.local');
  const [password, setPassword] = useState(import.meta.env.DEV ? 'User@12345' : '');
  const [remember, setRemember] = useState(true);
  const [login, { isLoading, error }] = useLoginMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await login({ email, password });
    if ('data' in result && result.data) {
      dispatch(setCredentials(result.data));
      if (result.data.user.accessExpired) {
        navigate('/access-expired');
        return;
      }
      navigate('/');
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
      <Card variant="outlined" sx={{ width: 420, bgcolor: 'background.paper' }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <ShowChartIcon color="primary" />
            <Typography variant="h5" fontWeight={800}>
              StockPred
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Intelligent Trading Workstation — invite-only.
          </Typography>
          {Boolean(error) && (
            <Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">
              {authErrorMessage(error, 'Invalid credentials.')}
            </Alert>
          )}
          <Box component="form" onSubmit={(e) => void onSubmit(e)}>
            <TextField
              label="Email"
              type="email"
              fullWidth
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputProps={{ 'data-testid': 'login-email' }}
            />
            <TextField
              label="Password"
              type="password"
              fullWidth
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              inputProps={{ 'data-testid': 'login-password' }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  size="small"
                />
              }
              label="Remember me (local session only)"
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              sx={{ mt: 1 }}
              disabled={isLoading}
              data-testid="login-submit"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Demo: user@stockpred.local / User@12345
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
