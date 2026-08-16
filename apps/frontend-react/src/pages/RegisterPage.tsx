import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authErrorMessage } from '../lib/auth-errors';
import { useAppDispatch } from '../store';
import { useRegisterMutation } from '../store/api';
import { setCredentials } from '../store/authSlice';

export default function RegisterPage(): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, { isLoading, error }] = useRegisterMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const result = await register({ name, email, password });
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
            Create account
          </Typography>
          {Boolean(error) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {authErrorMessage(
                error,
                'Registration failed. Password needs 10+ chars with upper, lower and a digit.',
              )}
            </Alert>
          )}
          <Box component="form" onSubmit={(e) => void onSubmit(e)}>
            <TextField
              label="Name"
              fullWidth
              margin="normal"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Email"
              type="email"
              fullWidth
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              fullWidth
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="At least 10 characters with upper case, lower case and a digit"
            />
            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Register'}
            </Button>
          </Box>
          <Typography variant="body2" sx={{ mt: 2 }}>
            Already registered? <Link to="/login">Login</Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
