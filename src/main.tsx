import {Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  registerSW({immediate: true});
}

createRoot(document.getElementById('root')!).render(
  <Suspense
    fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-sm text-slate-400">
        Chargement de PharmAgent…
      </div>
    }
  >
    <App />
  </Suspense>
);
