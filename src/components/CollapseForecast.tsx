/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CollapseForecast panel — renders the live, in-browser forecast produced
 * by services/CollapseForecaster.ts. Pure display component.
 */

import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, TrendingDown, Activity, Clock } from 'lucide-react';
import type { CollapseForecast } from '../types/simulation';

interface CollapseForecastProps {
  forecast: CollapseForecast | null;
}

function riskColor(risk: number): string {
  if (risk >= 75) return 'text-red-400 border-red-500/40 bg-red-500/10';
  if (risk >= 50) return 'text-orange-300 border-orange-500/40 bg-orange-500/10';
  if (risk >= 25) return 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10';
  return 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
}

function riskLabel(risk: number): string {
  if (risk >= 75) return 'CRITICAL';
  if (risk >= 50) return 'HIGH';
  if (risk >= 25) return 'ELEVATED';
  return 'NOMINAL';
}

const CollapseForecastPanel: React.FC<CollapseForecastProps> = ({ forecast }) => {
  if (!forecast) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-400">
        Forecaster initializing…
      </div>
    );
  }

  const colorClasses = riskColor(forecast.collapseRisk);
  const label = riskLabel(forecast.collapseRisk);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border p-4 ${colorClasses}`}
      data-testid="collapse-forecast-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4" />
          <h3 className="font-semibold text-sm tracking-wide">COLLAPSE FORECAST</h3>
        </div>
        <span className="text-[10px] uppercase tracking-widest opacity-70">
          local · continuous · no-API
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase opacity-70 mb-1">Risk</div>
          <div className="text-2xl font-bold">{forecast.collapseRisk.toFixed(0)}<span className="text-sm opacity-70">%</span></div>
          <div className="text-[10px] mt-0.5 opacity-80">{label}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase opacity-70 mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> ETA</div>
          <div className="text-2xl font-bold">
            {forecast.etaSteps === null ? '—' : `${forecast.etaSteps}`}
          </div>
          <div className="text-[10px] mt-0.5 opacity-80">
            {forecast.etaSteps === null ? 'stable' : 'steps to collapse'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase opacity-70 mb-1 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Slope</div>
          <div className="text-2xl font-bold">
            {forecast.trendSlope >= 0 ? '+' : ''}{forecast.trendSlope.toFixed(2)}
          </div>
          <div className="text-[10px] mt-0.5 opacity-80">health/step</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs mb-3 pt-3 border-t border-current/20">
        <div>
          <span className="opacity-70">Variance:</span>{' '}
          <span className="font-mono">{forecast.variance.toFixed(2)}</span>
        </div>
        <div>
          <span className="opacity-70">Lag-1 autocorr:</span>{' '}
          <span className="font-mono">{forecast.autocorrelation.toFixed(2)}</span>
        </div>
      </div>

      {forecast.warnings.length > 0 && (
        <div className="pt-3 border-t border-current/20">
          <div className="flex items-center gap-1 text-[10px] uppercase opacity-80 mb-1.5">
            <AlertTriangle className="w-3 h-3" /> Indicators
          </div>
          <ul className="space-y-1 text-xs">
            {forecast.warnings.map((w, i) => (
              <li key={i} className="opacity-90">• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
};

export default CollapseForecastPanel;
