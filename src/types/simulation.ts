/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum OrganType {
  METABOLIC_HUB = 'Metabolic Hub',
  SIGNAL_TRANSDUCER = 'Signal Transducer',
  RESOURCE_COLLECTOR = 'Resource Collector',
  STRUCTURAL_ANCHOR = 'Structural Anchor',
  IMMUNE_SENTINEL = 'Immune Sentinel',
}

export type AgentPolicy =
  | 'REACTIVE'
  | 'COOPERATIVE'
  | 'ECONOMIST'
  | 'EXPLORER'
  | 'DEFENDER';

export const AGENT_POLICY_INFO: Record<AgentPolicy, { label: string; description: string }> = {
  REACTIVE: { label: 'Reactive', description: 'Default behavior — responds proportionally to incoming signals.' },
  COOPERATIVE: { label: 'Cooperative', description: 'Slightly amplifies emergency alerts to broadcast to more neighbors.' },
  ECONOMIST: { label: 'Economist', description: 'Hoards energy — suppresses costly emergency alerts when energy is low.' },
  EXPLORER: { label: 'Explorer', description: 'Extends interaction radius by ~20% to discover distant neighbors.' },
  DEFENDER: { label: 'Defender', description: 'Triggers emergency alerts earlier (at higher health threshold).' },
};

export type GeneType = 'METABOLISM' | 'SIGNALING' | 'STABILITY' | 'GROWTH' | 'DEFENSE' | 'PATTERN_SCALING' | 'RECURSION_DEPTH' | 'ADAPTATION_SPEED' | 'RECOVERY_AGGRESSION' | 'STABILITY_THRESHOLD';

export interface Gene {
  id: string;
  type: GeneType;
  sequence: string; // Hex or Base4 string representation
  expression: number; // 0-1 multiplier for the effect
  description: string;
}

export interface ManagerDNA {
  genes: Gene[];
  version: number;
  lastMutationStep: number;
  phiHarmony: number; // 0-1 measure of Golden Ratio alignment
}

export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'CRITICAL';
export type IncidentStatus = 'DETECTED' | 'ANALYZING' | 'RECOVERING' | 'RESOLVED' | 'FAILED';
export type LogType = 'ERROR' | 'WARNING' | 'INFO' | 'DIAGNOSTIC';

export interface SystemLog {
  id: string;
  timestamp: number;
  type: LogType;
  source: string;
  message: string;
  details?: any;
  diagnosis?: string;
  severity: IncidentSeverity;
}

export interface HealthIncident {
  id: string;
  timestamp: number;
  step: number;
  type: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  description: string;
  affectedAgents: string[];
  rootCause?: string;
  recommendedAction?: string;
  actionsTaken: string[];
  isApplied?: boolean;
}

export interface SystemHealthState {
  overallScore: number; // 0-100
  latency: number;
  errorRate: number;
  resourceUsage: number;
  workerStatus?: 'IDLE' | 'BUSY' | 'UNAVAILABLE';
  parallelismActive?: boolean;
  activeIncidents: HealthIncident[];
  history: { step: number; score: number }[];
  systemLogs: SystemLog[];
}

export enum SignalPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export interface BioSignal {
  id: string;
  source: string;
  target: string;
  type: 'ATP' | 'HORMONAL' | 'ELECTRICAL' | 'CYTOKINE' | 'ALERT';
  payload: number;
  timestamp: number;
  step: number; // Simulation step when signal was created
  recursionLevel: number; // For fractal signal propagation
  priority: SignalPriority;
  isUrgent: boolean;
  parentId?: string; // ID of the signal that triggered this one (for tracing)
}

export interface SignalHistoryEntry {
  type: 'ATP' | 'HORMONAL' | 'ELECTRICAL' | 'CYTOKINE' | 'ALERT';
  priority: SignalPriority;
  isUrgent: boolean;
  step: number;
  payload: number;
}

export interface AgentState {
  id: string;
  name: string;
  type: OrganType;
  policy: AgentPolicy; // Per-agent local decision strategy ("micro-policy")
  health: number; // 0-100
  energy: number; // ATP levels
  sensitivity: number; // Response to signals
  memory: string[]; // Recent interactions
  signalHistory: SignalHistoryEntry[]; // History of processed signals
  phiPhase: number; // Current position in the golden spiral (0 to 2*PI)
  recursionLevel: number; // Depth in the hierarchical structure
  x?: number; // Position for spatial interaction
  y?: number;
  interactionRadius: number; // Dynamic range for signaling
  parameters: {
    metabolismRate: number;
    decayRate: number;
    signalThreshold: number;
    phiScaling: number; // Individual agent scaling based on Phi
  };
  linkedProtein?: string; // Real biological data mapping
}

export interface SimulationMetrics {
  totalAgents: number;
  averageHealth: number;
  entropy: number; // Measure of disorder/instability
  signalDensity: number;
  phiHarmony: number; // Overall ecosystem alignment with Phi
  step: number;
  failureRate: number; // Rate of health change per step
  history: number[]; // Last 50 health points for regression
  throughput?: number; // Steps per second
  memoryUsage?: number; // Estimated memory usage in bytes
  anomalies: {
    step: number;
    severity: number;
    type: string;
  }[];
}

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  type: 'SIGNAL' | 'MUTATION' | 'DEATH' | 'BIRTH';
  message: string;
  payload?: any;
}

export interface PredictionResult {
  stabilityScore: number;
  collapseProbability: number;
  recommendation: string;
  phiHarmony: number;
  timestamp: number;
}

export interface CollapseForecast {
  step: number;
  collapseRisk: number;        // 0-100
  etaSteps: number | null;     // estimated steps until critical (mean health < 30)
  trendSlope: number;          // health units per step
  variance: number;            // critical-slowing-down indicator
  autocorrelation: number;     // lag-1 autocorrelation
  warnings: string[];
}

export interface MutationSuggestion {
  agentId: string;
  originalName: string;
  newName: string;
  parameters: {
    metabolismRate: number;
    decayRate: number;
    signalThreshold: number;
    phiScaling: number;
  };
}
