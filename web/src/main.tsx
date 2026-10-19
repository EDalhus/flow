import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Fragment, StrictMode, Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ApiError } from './lib/api.ts';
import { useMe } from './lib/queries.ts';
import { useRealtime } from './lib/realtime.ts';
import { setTheme } from './lib/theme.ts';
import { getLang, loadLang, tr, tx } from './lib/i18n.ts';
import type { Lang } from '../../shared/api.ts';
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
const DriverApp = lazy(() => import('./driver/DriverApp.tsx').then(m => ({ default: m.DriverApp })));
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

const LANG_CODES: Lang[] = ['nb', 'en', 'lt', 'da', 'sv', 'is'];
/** Språket fra forrige besøk, til brukeren er hentet. */
const storedLang = (): Lang => { try { const v = localStorage.getItem('flow-sprak'); return LANG_CODES.includes(v as Lang) ? v as Lang : 'nb'; } catch { return 'nb'; } };

function App() {
  const me = useMe();
  useRealtime();
  const isNarrow = useNarrow();
  const theme = me.data?.prefs.theme;
  const lang = me.data?.prefs.lang ?? storedLang();
  useEffect(() => { if (me.data) setTheme(theme ?? 'mork'); }, [me.data, theme]);
  // Språket: ordboka hentes før siden vises på nytt, og valget huskes til neste gang siden åpnes.
  const [ready, setReady] = useState<Lang>(getLang());
  useEffect(() => {
    let live = true;
    try { localStorage.setItem('flow-sprak', lang); } catch { /* ignorer */ }
    loadLang(lang).then(() => live && setReady(lang), () => live && setReady(getLang()));
    return () => { live = false; };
  }, [lang]);

  if (me.isError) {
    const e = me.error;
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="glass" style={{ maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ margin: 0, fontWeight: 300, fontSize: 32 }}>Flow</h1>
          <p style={{ margin: 0 }}>{e instanceof ApiError ? tx(e.message) : tr('Kunne ikke kontakte serveren.')}</p>
          {e instanceof ApiError && e.status === 401 && <p className="muted" style={{ margin: 0 }}>{tr('Last siden på nytt for å logge inn via Cloudflare Access.')}</p>}
        </div>
      </main>
    );
  }
  if (me.isPending || ready !== lang) return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} className="loading">Flow</main>;

  return (
    <Suspense fallback={<main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} className="loading">Flow</main>}>
    <Fragment key={ready}>
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
      <Route path="/innstillinger" element={<AdminPage />} />
      <Route path="/admin" element={<Navigate to="/innstillinger" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Fragment>
    </Suspense>
  );
}

// Sjåførvisningen har egen innlogging og deler ingenting med resten av Flow.
const isDriver = location.pathname === '/sjafor' || location.pathname.startsWith('/sjafor/');

createRoot(document.getElementById('root')!).render(isDriver ? (
  <StrictMode>
    <Suspense fallback={<main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} className="loading">Flow</main>}>
      <DriverApp />
    </Suspense>
  </StrictMode>
) : (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
));
