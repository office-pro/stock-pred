import {
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { ReactNode, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppView, UserRole } from '@stockpred/shared-types';
import { useAppSelector } from '../store';
import { userHasView } from './RequireAuth';
import DisclaimerBanner from './DisclaimerBanner';
import IntelligenceBatchLiveStrip from './IntelligenceBatchLiveStrip';
import WorkstationHeader from './WorkstationHeader';

const DRAWER_WIDTH = 240;

type NavItem = { label: string; to: string; view: AppView };

const MAIN_NAV: NavItem[] = [
  { label: 'Overview', to: '/overview', view: AppView.DASHBOARD },
  { label: 'Market', to: '/market', view: AppView.DASHBOARD },
  { label: 'Sectors', to: '/sectors', view: AppView.DASHBOARD },
  { label: 'Prep', to: '/prep', view: AppView.AGENT },
  { label: 'Multi-Asset Batch', to: '/batch', view: AppView.AGENT },
  { label: 'Bull Run', to: '/bull-run', view: AppView.AGENT },
  { label: 'Research', to: '/research-reports', view: AppView.AGENT },
  { label: 'Desk', to: '/agent', view: AppView.AGENT },
  { label: 'Live Monitor', to: '/live', view: AppView.AGENT },
  { label: 'Book', to: '/book', view: AppView.PORTFOLIO },
];

const ADVANCED_NAV: NavItem[] = [
  { label: 'Scanner', to: '/scanner', view: AppView.SCANNER },
  { label: 'Signals', to: '/signals', view: AppView.SIGNALS },
  { label: 'Predictions', to: '/predictions', view: AppView.PREDICTIONS },
  { label: 'ML Center', to: '/ml-lab', view: AppView.ML_LAB },
  { label: 'Backtest', to: '/backtest', view: AppView.BACKTEST },
  { label: 'Brokers', to: '/broker-config', view: AppView.BROKER_CONFIG },
  { label: 'P5 Evidence', to: '/evidence', view: AppView.AGENT },
  { label: 'Advanced Intelligence', to: '/advanced/intelligence', view: AppView.AGENT },
  { label: 'Thesis', to: '/advanced/thesis', view: AppView.AGENT },
  { label: 'WAIT', to: '/advanced/wait', view: AppView.AGENT },
  { label: 'Exit', to: '/advanced/exit', view: AppView.AGENT },
  { label: 'Decision Center', to: '/advanced/decision', view: AppView.AGENT },
];

function NavSection({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <List
      dense
      subheader={
        <ListSubheader sx={{ bgcolor: 'transparent', lineHeight: 2.5 }}>{title}</ListSubheader>
      }
    >
      {items.map((item) => {
        const selected =
          item.to === '/market'
            ? pathname === '/market' || pathname === '/'
            : pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <ListItemButton
            key={item.to + item.label}
            component={Link}
            to={item.to}
            selected={selected}
            onClick={onNavigate}
            sx={{ borderRadius: 1, mx: 1 }}
          >
            <ListItemText primary={item.label} />
          </ListItemButton>
        );
      })}
    </List>
  );
}

export default function Layout({ children }: { children: ReactNode }): JSX.Element {
  const user = useAppSelector((state) => state.auth.user);
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const hideChrome = location.pathname === '/login' || location.pathname === '/forbidden' || !user;

  const mainItems = useMemo(
    () => (user ? MAIN_NAV.filter((i) => userHasView(user.role, user.allowedViews, i.view)) : []),
    [user],
  );
  const advancedItems = useMemo(
    () =>
      user ? ADVANCED_NAV.filter((i) => userHasView(user.role, user.allowedViews, i.view)) : [],
    [user],
  );
  const adminItems = useMemo(() => {
    if (!user) return [];
    const items: NavItem[] = [];
    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN) {
      items.push({ label: 'Users', to: '/admin/users', view: AppView.ADMIN_USERS });
      if (user.brandId) {
        items.push({ label: 'Brand', to: '/admin/brand', view: AppView.BRAND_SETTINGS });
      }
    }
    if (user.role === UserRole.SUPERADMIN) {
      items.push({ label: 'Brands', to: '/admin/brands', view: AppView.SUPERADMIN_BRANDS });
    }
    return items.filter((i) => userHasView(user.role, user.allowedViews, i.view));
  }, [user]);

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ gap: 1, px: 2 }}>
        <ShowChartIcon color="primary" />
        <Typography
          component={Link}
          to="/"
          variant="h6"
          sx={{ fontWeight: 800, textDecoration: 'none', color: 'inherit' }}
        >
          StockPred
        </Typography>
      </Toolbar>
      <Divider />
      <Box sx={{ overflow: 'auto', flex: 1, py: 1 }}>
        <NavSection
          title="Main"
          items={mainItems}
          pathname={location.pathname}
          onNavigate={() => setMobileOpen(false)}
        />
        <NavSection
          title="Advanced"
          items={advancedItems}
          pathname={location.pathname}
          onNavigate={() => setMobileOpen(false)}
        />
        <NavSection
          title="Admin"
          items={adminItems}
          pathname={location.pathname}
          onNavigate={() => setMobileOpen(false)}
        />
      </Box>
    </Box>
  );

  if (hideChrome) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Box sx={{ maxWidth: 480, mx: 'auto', py: 4, px: 2 }}>{children}</Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {isMobile ? (
        <>
          <IconButton
            onClick={() => setMobileOpen(true)}
            sx={{ position: 'fixed', top: 8, left: 8, zIndex: 1300 }}
            aria-label="Open menu"
          >
            <MenuIcon />
          </IconButton>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
            }}
          >
            {drawer}
          </Drawer>
        </>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <WorkstationHeader />
        <IntelligenceBatchLiveStrip />
        <Box sx={{ flex: 1, p: { xs: 2, md: 3 }, pt: { xs: 5, md: 3 } }}>
          <DisclaimerBanner />
          {children}
        </Box>
      </Box>
    </Box>
  );
}
