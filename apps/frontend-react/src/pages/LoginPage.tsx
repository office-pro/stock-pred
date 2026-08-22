import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authErrorMessage } from '../lib/auth-errors';
import { useAppDispatch } from '../store';
import { useLoginMutation } from '../store/api';
import { setCredentials } from '../store/authSlice';

export default function LoginPage(): JSX.Element {
  const [email, setEmail] = useState('user@stockpred.local');
  const [password, setPassword] = useState('');
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
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
      <Card variant="outlined" sx={{ width: 420 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Login
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Invite-only. Ask your admin for an account.
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
              helperText="Local: superadmin@ / admin@ / user@ / viewer@stockpred.local"
              inputProps={{ 'data-testid': 'login-password' }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              sx={{ mt: 2 }}
              disabled={isLoading}
              data-testid="login-submit"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
