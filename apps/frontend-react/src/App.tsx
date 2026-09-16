import { Route, Routes, Navigate } from 'react-router-dom';
import { AppView } from '@stockpred/shared-types';
import Layout from './components/Layout';
import { RequireAuth, RequireView } from './components/RequireAuth';
import { useSocket } from './hooks/useSocket';
import AccessExpiredPage from './pages/AccessExpiredPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdvancedIntelligencePage from './pages/AdvancedIntelligencePage';
import AgentDeskPage from './pages/AgentDeskPage';
import BacktestPage from './pages/BacktestPage';
import BatchCenterPage from './pages/BatchCenterPage';
import BullRunPage from './pages/BullRunPage';
import BookPage from './pages/BookPage';
import BrandSettingsPage from './pages/BrandSettingsPage';
import { BrokerConfigPage } from './pages/BrokerConfigPage';
import DashboardPage from './pages/DashboardPage';
import DecisionCenterPage from './pages/DecisionCenterPage';
import ExitIntelligencePage from './pages/ExitIntelligencePage';
import ForbiddenPage from './pages/ForbiddenPage';
import HomePage from './pages/HomePage';
import LiveMonitorPage from './pages/LiveMonitorPage';
import LoginPage from './pages/LoginPage';
import MarketOverviewPage from './pages/MarketOverviewPage';
import IntelligenceValidationPage from './pages/IntelligenceValidationPage';
import ResearchReportsPage from './pages/ResearchReportsPage';
import SectorOverviewPage from './pages/SectorOverviewPage';
import MlLabLayout from './pages/ml-lab/MlLabLayout';
import MlLabOverviewPage from './pages/ml-lab/MlLabOverviewPage';
import MlLabIngestionPage from './pages/ml-lab/MlLabIngestionPage';
import MlLabDatasetPage from './pages/ml-lab/MlLabDatasetPage';
import MlLabValidationPage from './pages/ml-lab/MlLabValidationPage';
import MlLabPredictionsPage from './pages/ml-lab/MlLabPredictionsPage';
import MlLabMonitoringPage from './pages/ml-lab/MlLabMonitoringPage';
import MlLabTiBridgePage from './pages/ml-lab/MlLabTiBridgePage';
import MlLabReportsPage from './pages/ml-lab/MlLabReportsPage';
import MlLabRegistryPage from './pages/ml-lab/MlLabRegistryPage';
import MlLabPage from './pages/MlLabPage';
import P5EvidencePage from './pages/P5EvidencePage';
import PredictionsPage from './pages/PredictionsPage';
import PrepFocusPage from './pages/PrepFocusPage';
import ScannerPage from './pages/ScannerPage';
import SignalsPage from './pages/SignalsPage';
import StockDetailPage from './pages/StockDetailPage';
import SuperadminBrandsPage from './pages/SuperadminBrandsPage';
import ThesisIntelligencePage from './pages/ThesisIntelligencePage';
import TradePlanPage from './pages/TradePlanPage';
import WaitIntelligencePage from './pages/WaitIntelligencePage';

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
        <Route path="/" element={gated(AppView.DASHBOARD, <HomePage />)} />
        <Route path="/overview" element={gated(AppView.DASHBOARD, <MarketOverviewPage />)} />
        <Route
          path="/intelligence-validation"
          element={gated(AppView.AGENT, <IntelligenceValidationPage />)}
        />
        <Route path="/market" element={gated(AppView.DASHBOARD, <DashboardPage />)} />
        <Route path="/sectors" element={gated(AppView.DASHBOARD, <SectorOverviewPage />)} />
        <Route path="/prep" element={gated(AppView.AGENT, <PrepFocusPage />)} />
        <Route path="/batch" element={gated(AppView.AGENT, <BatchCenterPage />)} />
        <Route path="/bull-run" element={gated(AppView.AGENT, <BullRunPage />)} />
        <Route path="/research-reports" element={gated(AppView.AGENT, <ResearchReportsPage />)} />
        <Route path="/live" element={gated(AppView.AGENT, <LiveMonitorPage />)} />
        <Route path="/desk/trade-plan/:symbol" element={gated(AppView.AGENT, <TradePlanPage />)} />
        <Route path="/agent" element={gated(AppView.AGENT, <AgentDeskPage />)} />
        <Route path="/book" element={gated(AppView.PORTFOLIO, <BookPage />)} />
        <Route path="/portfolio" element={<Navigate to="/book" replace />} />
        <Route path="/evidence" element={gated(AppView.AGENT, <P5EvidencePage />)} />
        <Route
          path="/advanced/intelligence"
          element={gated(AppView.AGENT, <AdvancedIntelligencePage />)}
        />
        <Route path="/advanced/thesis" element={gated(AppView.AGENT, <ThesisIntelligencePage />)} />
        <Route path="/advanced/wait" element={gated(AppView.AGENT, <WaitIntelligencePage />)} />
        <Route path="/advanced/exit" element={gated(AppView.AGENT, <ExitIntelligencePage />)} />
        <Route path="/advanced/decision" element={gated(AppView.AGENT, <DecisionCenterPage />)} />
        <Route path="/scanner" element={gated(AppView.SCANNER, <ScannerPage />)} />
        <Route path="/stocks/:symbol" element={gated(AppView.STOCK_DETAIL, <StockDetailPage />)} />
        <Route path="/signals" element={gated(AppView.SIGNALS, <SignalsPage />)} />
        <Route path="/predictions" element={gated(AppView.PREDICTIONS, <PredictionsPage />)} />
        <Route path="/ml-lab" element={gated(AppView.ML_LAB, <MlLabLayout />)}>
          <Route index element={<MlLabOverviewPage />} />
          <Route path="ingestion" element={<MlLabIngestionPage />} />
          <Route path="dataset" element={<MlLabDatasetPage />} />
          <Route path="validation" element={<MlLabValidationPage />} />
          <Route path="predictions" element={<MlLabPredictionsPage />} />
          <Route path="monitoring" element={<MlLabMonitoringPage />} />
          <Route path="ti-bridge" element={<MlLabTiBridgePage />} />
          <Route path="reports" element={<MlLabReportsPage />} />
          <Route path="registry" element={<MlLabRegistryPage />} />
          <Route path="jobs" element={<MlLabPage />} />
        </Route>
        <Route path="/backtest" element={gated(AppView.BACKTEST, <BacktestPage />)} />
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
