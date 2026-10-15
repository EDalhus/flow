import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ApiError } from './lib/api.ts';
import { useMe } from './lib/queries.ts';
import { useRealtime } from './lib/realtime.ts';
import './styles/global.css';

// Hver side lastes ved behov; kartbiblioteket (MapLibre) hentes bare på kart og mobil.
const KartPage = lazy(() => import('./pages/KartPage.tsx').then(m => ({ default: m.KartPage })));
const MobileApp = lazy(() => import('./mobile/MobileApp.tsx').then(m => ({ default: m.MobileApp })));
const AnlopPage = lazy(() => import('./pages/AnlopPage.tsx').then(m => ({ default: m.AnlopPage })));
const BaaterPage = lazy(() => import('./pages/BaaterPage.tsx').then(m => ({ default: m.BaaterPage })));
const KaibokLogPage = lazy(() => import('./pages/KaibokLogPage.tsx').then(m => ({ default: m.KaibokLogPage })));
const AdminPage = lazy(() => import('./pages/AdminPage.tsx').then(m => ({ default: m.AdminPage })));
const BilerPage = lazy(() => import('./pages/BilerPage.tsx').then(m => ({ default: m.BilerPage })));
const BulkPage = lazy(() => import('./pages/BulkPage.tsx').then(m => ({ default: m.BulkPage })));
const ProduksjonPage = lazy(() => import('./pages/ProduksjonPage.tsx').then(m => ({ default: m.ProduksjonPage })));
const HjullasterPage = lazy(() => import('./pages/HjullasterPage.tsx').then(m => ({ default: m.HjullasterPage })));
const RapporterPage = lazy(() => import('./pages/RapporterPage.tsx').then(m => ({ default: m.RapporterPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

const narrow = window.matchMedia('(max-width: 900px)');
const useNarrow = () => useSyncExternalStore(cb => { narrow.addEventListener('change', cb); return () => narrow.removeEventListener('change', cb); }, () => narrow.matches);

function App() {
  const me = useMe();
  useRealtime();
  const isNarrow = useNarrow();

  if (me.isError) {
    const e = me.error;
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="glass" style={{ maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ margin: 0, fontWeight: 300, fontSize: 32 }}>Flow</h1>
          <p style={{ margin: 0 }}>{e instanceof ApiError ? e.message : 'Kunne ikke kontakte serveren.'}</p>
          {e instanceof ApiError && e.status === 401 && <p className="muted" style={{ margin: 0 }}>Last siden på nytt for å logge inn via Cloudflare Access.</p>}
        </div>
      </main>
    );
  }
  if (me.isPending) return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} className="loading">Flow</main>;

  return (
    <Suspense fallback={<main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} className="loading">Flow</main>}>
    <Routes>
      {/* Smale skjermer (kaiarbeidere på telefon) får mobilvisningen på forsiden. */}
      <Route path="/" element={isNarrow ? <MobileApp /> : <KartPage />} />
      <Route path="/m" element={<MobileApp />} />
      <Route path="/anlop" element={<AnlopPage />} />
      <Route path="/baater" element={<BaaterPage />} />
      <Route path="/kaibok" element={<KaibokLogPage />} />
      <Route path="/biler" element={<BilerPage />} />
      <Route path="/bulk" element={<BulkPage />} />
      <Route path="/produksjon" element={<ProduksjonPage />} />
      <Route path="/hjullaster" element={<HjullasterPage />} />
      <Route path="/rapporter" element={<RapporterPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
