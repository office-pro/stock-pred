import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useSocket } from './hooks/useSocket';
import BacktestPage from './pages/BacktestPage';
import { BrokerConfigPage } from './pages/BrokerConfigPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import PortfolioPage from './pages/PortfolioPage';
import PredictionsPage from './pages/PredictionsPage';
import RegisterPage from './pages/RegisterPage';
import ScannerPage from './pages/ScannerPage';
import SignalsPage from './pages/SignalsPage';
import StockDetailPage from './pages/StockDetailPage';

export default function App(): JSX.Element {
  useSocket();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/scanner" element={<ScannerPage />} />
        <Route path="/stocks/:symbol" element={<StockDetailPage />} />
        <Route path="/signals" element={<SignalsPage />} />
        <Route path="/predictions" element={<PredictionsPage />} />
        <Route path="/backtest" element={<BacktestPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/broker-config" element={<BrokerConfigPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Routes>
    </Layout>
  );
}
