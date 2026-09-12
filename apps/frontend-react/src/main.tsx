import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { store } from './store';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#3b82f6' },
    success: { main: '#22c55e' },
    warning: { main: '#eab308' },
    error: { main: '#ef4444' },
    background: { default: '#0a0e17', paper: '#111827' },
    divider: 'rgba(148, 163, 184, 0.16)',
  },
  typography: {
    fontFamily: 'Inter, Roboto, system-ui, sans-serif',
  },
  shape: { borderRadius: 10 },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </Provider>
  </React.StrictMode>,
);
