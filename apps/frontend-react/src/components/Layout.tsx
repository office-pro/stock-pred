import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppView, UserRole } from '@stockpred/shared-types';
import { useAppDispatch, useAppSelector } from '../store';
import { logout } from '../store/authSlice';
import { userHasView } from './RequireAuth';
import DisclaimerBanner from './DisclaimerBanner';

const NAV_ITEMS: { label: string; to: string; view: AppView }[] = [
  { label: 'Dashboard', to: '/', view: AppView.DASHBOARD },
  { label: 'Agent', to: '/agent', view: AppView.AGENT },
  { label: 'Scanner', to: '/scanner', view: AppView.SCANNER },
  { label: 'Signals', to: '/signals', view: AppView.SIGNALS },
  { label: 'ML Predictions', to: '/predictions', view: AppView.PREDICTIONS },
  { label: 'ML Lab', to: '/ml-lab', view: AppView.ML_LAB },
  { label: 'Backtest', to: '/backtest', view: AppView.BACKTEST },
  { label: 'Paper book', to: '/portfolio', view: AppView.PORTFOLIO },
  { label: 'Brokers', to: '/broker-config', view: AppView.BROKER_CONFIG },
];

export default function Layout({ children }: { children: ReactNode }): JSX.Element {
  const user = useAppSelector((state) => state.auth.user);
  const connected = useAppSelector((state) => state.live.connected);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const visibleNav = user
    ? NAV_ITEMS.filter((item) => userHasView(user.role, user.allowedViews, item.view))
    : [];

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="sticky" color="transparent" sx={{ backdropFilter: 'blur(8px)' }}>
        <Toolbar>
          <ShowChartIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ mr: 4, fontWeight: 700 }}>
            StockPred
          </Typography>
          {visibleNav.map((item) => (
            <Button key={item.to} component={Link} to={item.to} color="inherit" sx={{ mr: 1 }}>
              {item.label}
            </Button>
          ))}
          {user && (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN) && (
            <Button component={Link} to="/admin/users" color="inherit" sx={{ mr: 1 }}>
              Users
            </Button>
          )}
          {user &&
            (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN) &&
            user.brandId && (
              <Button component={Link} to="/admin/brand" color="inherit" sx={{ mr: 1 }}>
                Brand
              </Button>
            )}
          {user?.role === UserRole.SUPERADMIN && (
            <Button component={Link} to="/admin/brands" color="inherit" sx={{ mr: 1 }}>
              Brands
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Chip
            size="small"
            label={connected ? 'ONLINE' : 'OFFLINE'}
            color={connected ? 'success' : 'default'}
            sx={{ mr: 2 }}
          />
          {user ? (
            <>
              <Chip
                size="small"
                label={`${user.name} (${user.role}${user.brand?.name ? ` · ${user.brand.name}` : ''})`}
                sx={{ mr: 1 }}
              />
              <Button
                color="inherit"
                onClick={() => {
                  dispatch(logout());
                  navigate('/login');
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
