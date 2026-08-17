import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store';
import { logout } from '../store/authSlice';
import DisclaimerBanner from './DisclaimerBanner';

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/' },
  { label: 'Scanner', to: '/scanner' },
  { label: 'Signals', to: '/signals' },
  { label: 'ML Predictions', to: '/predictions' },
  { label: 'ML Lab', to: '/ml-lab' },
  { label: 'Backtest', to: '/backtest' },
  { label: 'Paper book', to: '/portfolio' },
  { label: 'Brokers', to: '/broker-config' },
];

export default function Layout({ children }: { children: ReactNode }): JSX.Element {
  const user = useAppSelector((state) => state.auth.user);
  const connected = useAppSelector((state) => state.live.connected);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="sticky" color="transparent" sx={{ backdropFilter: 'blur(8px)' }}>
        <Toolbar>
          <ShowChartIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ mr: 4, fontWeight: 700 }}>
            StockPred
          </Typography>
          {NAV_ITEMS.map((item) => (
            <Button key={item.to} component={Link} to={item.to} color="inherit" sx={{ mr: 1 }}>
              {item.label}
            </Button>
          ))}
          <Box sx={{ flexGrow: 1 }} />
          <Chip
            size="small"
            label={connected ? 'ONLINE' : 'OFFLINE'}
            color={connected ? 'success' : 'default'}
            sx={{ mr: 2 }}
          />
          {user ? (
            <>
              <Chip size="small" label={`${user.name} (${user.role})`} sx={{ mr: 1 }} />
              <Button
                color="inherit"
                onClick={() => {
                  dispatch(logout());
                  navigate('/');
                }}
              >
                Logout
              </Button>
            </>
          ) : (
            <Button color="inherit" component={Link} to="/login">
              Login
            </Button>
          )}
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <DisclaimerBanner />
        {children}
      </Container>
    </Box>
  );
}
