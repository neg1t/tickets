import { lazy, Suspense } from 'react';
import { DashboardPage } from '../pages/dashboard';

const ApiStudioPage = lazy(() => import('../pages/api/ApiStudioPage.js'));

export function App() {
  const apiMode = import.meta.env.VITE_HALL_MODE === 'api' || (
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('mode') === 'api'
  );
  if (apiMode)
    return <Suspense fallback={<main>Загрузка API Studio…</main>}><ApiStudioPage /></Suspense>;
  return <DashboardPage />;
}
