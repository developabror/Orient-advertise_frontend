import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { AuthProvider } from '@api/AuthProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ErrorBoundary, ErrorDialogHost, Toaster } from '@components';
// Side-effect import: initialises the shared i18next instance before any
// component calls useTranslation(). Must run before <App /> renders.
import '@/i18n/config';
import '@/index.css';
import '@/components/ui/ui.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        {/* Last line of defence: a render error anywhere below shows a page with a way out
            instead of unmounting the tree and leaving a blank white screen (VG-13). */}
        <ErrorBoundary>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ErrorBoundary>
        <Toaster />
        <ErrorDialogHost />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
