import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppDispatch } from '../store';
import { useLoginMutation } from '../store/api';
import { setCredentials } from '../store/authSlice';

export default function LoginPage(): JSX.Element {
  const [email, setEmail] = useState('trader@stockpred.local');
  const [password, setPassword] = useState('');
  const [login, { isLoading, error }] = useLoginMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await login({ email, password });
    if ('data' in result && result.data) {
      dispatch(setCredentials(result.data));
      navigate('/');
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
      <Card variant="outlined" sx={{ width: 380 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Login
          </Typography>
          {Boolean(error) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Invalid credentials.
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
          <Typography variant="body2" sx={{ mt: 2 }}>
            No account? <Link to="/register">Register</Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
