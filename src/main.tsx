import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import SystemBoot from './components/SystemBoot.tsx';
import './index.css';

function Root() {
  const skipBoot =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('skipBoot') ||
      window.sessionStorage.getItem('boss_booted') === '1');
  const [booted, setBooted] = useState(skipBoot);
  return (
    <ErrorBoundary>
      {!booted && (
        <SystemBoot
          onComplete={() => {
            try { window.sessionStorage.setItem('boss_booted', '1'); } catch {}
            setBooted(true);
          }}
        />
      )}
      <App />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
