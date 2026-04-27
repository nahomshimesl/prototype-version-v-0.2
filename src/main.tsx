import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import SystemBoot from './components/SystemBoot.tsx';
import './index.css';

function Root() {
  // The boot screen shows on every full page load. Users who want to bypass it
  // can either click the "Skip · Enter Workbench" button in the boot footer,
  // or append `?skipBoot=1` to the URL to skip it on load.
  // (Older builds also cached a `boss_booted` flag in sessionStorage that hid
  // the boot on later visits — that auto-skip is removed because users
  // reported the loading screen never appeared.)
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const skipBoot = params.has('skipBoot');
  const [booted, setBooted] = useState(skipBoot);
  return (
    <ErrorBoundary>
      {!booted && (
        <SystemBoot onComplete={() => setBooted(true)} />
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
