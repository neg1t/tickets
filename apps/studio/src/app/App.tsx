import { lazy, Suspense } from 'react';
import { DashboardPage } from '../pages/dashboard';

const ApiStudioPage = lazy(() => import('../pages/api/ApiStudioPage.js'));

export function App() {
  if (import.meta.env.VITE_HALL_MODE === 'api')
    return <Suspense fallback={<main>Загрузка API Studio…</main>}><ApiStudioPage /></Suspense>;
  return <DashboardPage />;
}
