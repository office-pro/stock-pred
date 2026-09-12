import { Navigate, useLocation } from 'react-router-dom';
import { AppView, UserRole, UserStatus } from '@stockpred/shared-types';
import { useAppSelector } from '../store';

const ROUTE_VIEWS: { prefix: string; view: AppView }[] = [
  { prefix: '/agent', view: AppView.AGENT },
  { prefix: '/prep', view: AppView.AGENT },
  { prefix: '/evidence', view: AppView.AGENT },
  { prefix: '/advanced/', view: AppView.AGENT },
  { prefix: '/book', view: AppView.PORTFOLIO },
  { prefix: '/scanner', view: AppView.SCANNER },
  { prefix: '/signals', view: AppView.SIGNALS },
  { prefix: '/predictions', view: AppView.PREDICTIONS },
  { prefix: '/ml-lab', view: AppView.ML_LAB },
  { prefix: '/backtest', view: AppView.BACKTEST },
  { prefix: '/portfolio', view: AppView.PORTFOLIO },
  { prefix: '/broker-config', view: AppView.BROKER_CONFIG },
  { prefix: '/stocks/', view: AppView.STOCK_DETAIL },
  { prefix: '/admin/users', view: AppView.ADMIN_USERS },
  { prefix: '/admin/brand', view: AppView.BRAND_SETTINGS },
  { prefix: '/admin/brands', view: AppView.SUPERADMIN_BRANDS },
  { prefix: '/market', view: AppView.DASHBOARD },
  { prefix: '/', view: AppView.DASHBOARD },
];

export function viewForPath(pathname: string): AppView | null {
  const hit = ROUTE_VIEWS.find((r) =>
    r.prefix === '/' ? pathname === '/' : pathname.startsWith(r.prefix),
  );
  return hit?.view ?? null;
}

export function userHasView(
  role: UserRole,
  allowedViews: AppView[] | undefined,
  view: AppView,
): boolean {
  if (role === UserRole.SUPERADMIN || role === UserRole.ADMIN) {
    if (view === AppView.SUPERADMIN_BRANDS) return role === UserRole.SUPERADMIN;
    return true;
  }
  return (allowedViews ?? []).includes(view);
}

function isViewerExpired(user: {
  role: UserRole;
  accessExpired?: boolean;
  accessExpiresAt?: string | null;
}): boolean {
  if (user.role !== UserRole.VIEWER) return false;
  if (user.accessExpired) return true;
  if (user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() < Date.now()) return true;
  return false;
}

export function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const user = useAppSelector((s) => s.auth.user);
  const token = useAppSelector((s) => s.auth.accessToken);
  const location = useLocation();

  if (!user || !token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user.status === UserStatus.SUSPENDED) {
    return <Navigate to="/login" replace />;
  }
  if (isViewerExpired(user) && !location.pathname.startsWith('/access-expired')) {
    return <Navigate to="/access-expired" replace />;
  }
  return children;
}

export function RequireView({
  view,
  children,
}: {
  view: AppView;
  children: JSX.Element;
}): JSX.Element {
  const user = useAppSelector((s) => s.auth.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!userHasView(user.role, user.allowedViews, view)) {
    return <Navigate to="/forbidden" replace />;
  }
  return children;
}
