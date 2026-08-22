import { Route, Routes, Navigate } from 'react-router-dom';
import { AppView } from '@stockpred/shared-types';
import Layout from './components/Layout';
import { RequireAuth, RequireView } from './components/RequireAuth';
import { useSocket } from './hooks/useSocket';
import AccessExpiredPage from './pages/AccessExpiredPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AgentDeskPage from './pages/AgentDeskPage';
import BacktestPage from './pages/BacktestPage';
import BrandSettingsPage from './pages/BrandSettingsPage';
import { BrokerConfigPage } from './pages/BrokerConfigPage';
import DashboardPage from './pages/DashboardPage';
import ForbiddenPage from './pages/ForbiddenPage';
import LoginPage from './pages/LoginPage';
import PortfolioPage from './pages/PortfolioPage';
import MlLabPage from './pages/MlLabPage';
import PredictionsPage from './pages/PredictionsPage';
import ScannerPage from './pages/ScannerPage';
import SignalsPage from './pages/SignalsPage';
import StockDetailPage from './pages/StockDetailPage';
import SuperadminBrandsPage from './pages/SuperadminBrandsPage';

function gated(view: AppView, page: JSX.Element): JSX.Element {
  return (
    <RequireAuth>
      <RequireView view={view}>{page}</RequireView>
    </RequireAuth>
  );
}

export default function App(): JSX.Element {
  useSocket();
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/access-expired"
          element={
            <RequireAuth>
              <AccessExpiredPage />
            </RequireAuth>
          }
        />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="/" element={gated(AppView.DASHBOARD, <DashboardPage />)} />
        <Route path="/agent" element={gated(AppView.AGENT, <AgentDeskPage />)} />
        <Route path="/scanner" element={gated(AppView.SCANNER, <ScannerPage />)} />
        <Route path="/stocks/:symbol" element={gated(AppView.STOCK_DETAIL, <StockDetailPage />)} />
        <Route path="/signals" element={gated(AppView.SIGNALS, <SignalsPage />)} />
        <Route path="/predictions" element={gated(AppView.PREDICTIONS, <PredictionsPage />)} />
        <Route path="/ml-lab" element={gated(AppView.ML_LAB, <MlLabPage />)} />
        <Route path="/backtest" element={gated(AppView.BACKTEST, <BacktestPage />)} />
        <Route path="/portfolio" element={gated(AppView.PORTFOLIO, <PortfolioPage />)} />
        <Route path="/broker-config" element={gated(AppView.BROKER_CONFIG, <BrokerConfigPage />)} />
        <Route path="/admin/users" element={gated(AppView.ADMIN_USERS, <AdminUsersPage />)} />
        <Route path="/admin/brand" element={gated(AppView.BRAND_SETTINGS, <BrandSettingsPage />)} />
        <Route
          path="/admin/brands"
          element={gated(AppView.SUPERADMIN_BRANDS, <SuperadminBrandsPage />)}
        />
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
