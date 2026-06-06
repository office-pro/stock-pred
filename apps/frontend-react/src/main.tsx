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
    primary: { main: '#4f8cff' },
    success: { main: '#26a69a' },
    error: { main: '#ef5350' },
    background: { default: '#0b0f19', paper: '#121826' },
  },
  typography: {
    fontFamily: 'Inter, Roboto, system-ui, sans-serif',
  },
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
