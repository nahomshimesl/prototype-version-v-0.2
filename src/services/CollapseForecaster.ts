/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CollapseForecaster
 * ------------------
 * Continuous, deterministic, in-browser forecaster for ecosystem collapse.
 * Runs every tick, no API calls required, complements the on-demand AI prediction.
 *
 * Uses three established critical-slowing-down (CSD) indicators from theoretical
 * ecology / regime-shift literature:
 *   1. Trend slope of mean health (linear regression)
 *   2. Variance over a recent window (instability rises before regime shifts)
 *   3. Lag-1 autocorrelation (system "remembers" perturbations longer near a tipping point)
 *
 * Each contributes to a composite collapseRisk score (0-100), and a linear
 * extrapolation gives an ETA in steps until mean health crosses the critical
 * threshold (30 by default).
 */

import type { SimulationMetrics, CollapseForecast } from '../types/simulation';

const COLLAPSE_HEALTH_THRESHOLD = 30;
const WINDOW_SIZE = 20;
const MIN_SAMPLES = 10;

export function forecastCollapse(metrics: SimulationMetrics, currentStep: number): CollapseForecast {
  const history = metrics.history ?? [];
  const warnings: string[] = [];

  if (history.length < MIN_SAMPLES) {
    return {
      step: currentStep,
      collapseRisk: 0,
      etaSteps: null,
      trendSlope: 0,
      variance: 0,
      autocorrelation: 0,
      warnings: [`Warming up (${history.length}/${MIN_SAMPLES} samples)`],
    };
  }

  const window = history.slice(-WINDOW_SIZE);
  const n = window.length;
  const mean = window.reduce((s, v) => s + v, 0) / n;

  // Variance — rises as the system loses resilience
  const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  // Lag-1 autocorrelation — values closer to 1 = critical slowing down
  let num = 0;
  let den = 0;
  for (let i = 1; i < n; i++) num += (window[i] - mean) * (window[i - 1] - mean);
  for (const v of window) den += (v - mean) ** 2;
  const autocorrelation = den > 0 ? num / den : 0;

  // Linear regression slope (health units per step)
  const xMean = (n - 1) / 2;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov += (i - xMean) * (window[i] - mean);
    varX += (i - xMean) ** 2;
  }
  const trendSlope = varX > 0 ? cov / varX : 0;

  // Compose risk: each component contributes a bounded amount
  const slopeRisk = Math.max(0, Math.min(50, -trendSlope * 25));      // negative slope = collapsing
  const varianceRisk = Math.min(20, variance * 0.5);                  // high variance = unstable
  const autocorrRisk = Math.max(0, Math.min(15, autocorrelation * 25));// CSD indicator
  const healthRisk = Math.max(0, Math.min(15, (60 - mean) * 0.5));    // already low health
  const collapseRisk = Math.max(0, Math.min(100, slopeRisk + varianceRisk + autocorrRisk + healthRisk));

  // ETA: linear extrapolation until mean crosses the collapse threshold
  let etaSteps: number | null = null;
  if (trendSlope < -0.05 && mean > COLLAPSE_HEALTH_THRESHOLD) {
    etaSteps = Math.max(0, Math.floor((mean - COLLAPSE_HEALTH_THRESHOLD) / -trendSlope));
  }

  // Human-readable warnings
  if (trendSlope < -0.5) warnings.push(`Health declining at ${trendSlope.toFixed(2)}/step`);
  if (variance > 30) warnings.push(`Variance elevated (${variance.toFixed(1)}) — instability rising`);
  if (autocorrelation > 0.7) warnings.push(`Lag-1 autocorr ${autocorrelation.toFixed(2)} — critical slowing down`);
  if (mean < 50) warnings.push(`Mean health ${mean.toFixed(1)} (below 50)`);
  if (typeof metrics.entropy === 'number' && metrics.entropy > 0.7) {
    warnings.push(`Entropy elevated (${metrics.entropy.toFixed(2)})`);
  }

  return {
    step: currentStep,
    collapseRisk,
    etaSteps,
    trendSlope,
    variance,
    autocorrelation,
    warnings,
  };
}
