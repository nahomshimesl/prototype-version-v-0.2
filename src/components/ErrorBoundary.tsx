/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { healthEngine } from '../services/HealthEngine';
import { SentinelClient } from '../services/SentinelClient';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends (React.Component as any) {
  constructor(props: any) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    
    // Report to Health Engine for diagnosis
    healthEngine.reportExternalError(
      'React ErrorBoundary',
      error.message,
      'CRITICAL',
      { componentStack: errorInfo.componentStack }
    );

    // Report to Stability Sentinel
    SentinelClient.report({
      source: 'react-error-boundary',
      kind: error.name || 'ReactError',
      message: error.message,
      stack: error.stack,
      severity: 'CRITICAL',
      context: { componentStack: errorInfo.componentStack },
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-emerald-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-emerald-900 border border-emerald-800 rounded-3xl p-8 text-center space-y-6 shadow-2xl">
            <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto border border-rose-500/20">
              <AlertTriangle className="text-rose-500" size={40} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-emerald-50">System Interruption</h1>
              <p className="text-emerald-400 text-sm leading-relaxed">
                A critical exception occurred in the UI layer. The Health Engine has been notified and is currently diagnosing the issue.
              </p>
            </div>

            <div className="p-4 bg-emerald-950 rounded-2xl border border-emerald-800 text-left">
              <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-2">Error Trace</div>
              <div className="text-xs font-mono text-rose-400 break-all">
                {this.state.error?.message}
              </div>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 text-emerald-950 rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95"
            >
              <RefreshCcw size={18} />
              Reboot Interface
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
