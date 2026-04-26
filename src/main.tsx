import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import SystemBoot from './components/SystemBoot.tsx';
import './index.css';

function Root() {
  const [booted, setBooted] = useState(false);
  return (
    <ErrorBoundary>
      {!booted && <SystemBoot onComplete={() => setBooted(true)} />}
      <App />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
