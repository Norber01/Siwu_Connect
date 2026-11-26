import { CropProvider } from './components/Cropper';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/Toast';
import './index.css';
import { initTheme } from './components/theme';

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => count < 2 && !(error instanceof Error && /permission/i.test(error.message)),
      refetchOnWindowFocus: false, // save mobile data
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: false, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <ToastProvider>
            <CropProvider>
              <App />
            </CropProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
