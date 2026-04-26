/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentState, OrganType, BioSignal, ManagerDNA, GeneType, SignalPriority, AgentPolicy } from '../types/simulation';

// Default per-agent decision policy ("micro-policy"), assigned by organ type.
// Each agent still gets some random variation so populations are heterogeneous.
function pickPolicyForType(type: OrganType): AgentPolicy {
  const r = Math.random();
  switch (type) {
    case OrganType.METABOLIC_HUB:       return r < 0.7 ? 'ECONOMIST'   : 'REACTIVE';
    case OrganType.IMMUNE_SENTINEL:     return r < 0.7 ? 'DEFENDER'    : 'COOPERATIVE';
    case OrganType.SIGNAL_TRANSDUCER:   return r < 0.7 ? 'COOPERATIVE' : 'REACTIVE';
    case OrganType.RESOURCE_COLLECTOR:  return r < 0.7 ? 'EXPLORER'    : 'REACTIVE';
    case OrganType.STRUCTURAL_ANCHOR:   return r < 0.8 ? 'REACTIVE'    : 'DEFENDER';
    default:                            return 'REACTIVE';
  }
}

// Per-policy modifier for the dynamic interaction radius.
function policyRadiusMultiplier(policy: AgentPolicy): number {
  return policy === 'EXPLORER' ? 1.2 : 1.0;
}

// Per-policy decision: should this agent emit an emergency ALERT this step?
// Reactive uses the original threshold (health<30, energy>10). Other policies tweak it.
function shouldEmitEmergencyAlert(policy: AgentPolicy, health: number, energy: number): boolean {
  switch (policy) {
    case 'ECONOMIST':  return health < 30 && energy > 25; // hoards energy
    case 'DEFENDER':   return health < 40 && energy > 10; // earlier alert
    case 'COOPERATIVE':return health < 30 && energy > 8;  // alerts even with little energy
    case 'EXPLORER':
    case 'REACTIVE':
    default:           return health < 30 && energy > 10;
  }
}

// Mock UniProt-style data for initialization
const BIO_DATA_POOL = [
  { protein: 'P01308', name: 'Insulin', type: OrganType.SIGNAL_TRANSDUCER },
  { protein: 'P00533', name: 'EGFR', type: OrganType.SIGNAL_TRANSDUCER },
  { protein: 'P04637', name: 'p53', type: OrganType.IMMUNE_SENTINEL },
  { protein: 'P68871', name: 'Hemoglobin', type: OrganType.RESOURCE_COLLECTOR },
  { protein: 'P00338', name: 'LDH', type: OrganType.METABOLIC_HUB },
  { protein: 'P02647', name: 'ApoA1', type: OrganType.METABOLIC_HUB },
  { protein: 'P07355', name: 'Annexin A2', type: OrganType.STRUCTURAL_ANCHOR },
];

const PHI = 1.61803398875;

/**
 * Enhanced Metabolic Flux Engine
 * Uses a simplified flux balance simulation to calculate energy efficiency.
 */
class MetabolicFluxEngine {
  static calculateFlux(glucose: number, oxygen: number, efficiency: number): number {
    // Simulated stoichiometric matrix calculation
    const basicFlux = (glucose * 2) + (oxygen * 3);
    const limitation = Math.min(glucose, oxygen / PHI);
    return basicFlux * limitation * efficiency;
  }

  static optimizePathway(energy: number, agents: AgentState[]): number {
    // Heuristic optimization of metabolic pathways
    const hubCount = agents.filter(a => a.type === OrganType.METABOLIC_HUB).length;
    return energy * (1 + (hubCount * 0.05));
  }
}

/**
 * SpatialGrid for optimizing neighbor lookups.
 * Reduces O(N^2) distance calculations to O(N * K).
 */
class SpatialGrid {
  private grid: Map<string, AgentState[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private getKey(x: number, y: number): string {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    return `${gx},${gy}`;
  }

  insert(agent: AgentState) {
    if (agent.x === undefined || agent.y === undefined) return;
    const key = this.getKey(agent.x, agent.y);
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key)!.push(agent);
  }

  query(x: number, y: number, radius: number): AgentState[] {
    const results: AgentState[] = [];
    const startX = Math.floor((x - radius) / this.cellSize);
    const endX = Math.floor((x + radius) / this.cellSize);
    const startY = Math.floor((y - radius) / this.cellSize);
    const endY = Math.floor((y + radius) / this.cellSize);

    for (let gx = startX; gx <= endX; gx++) {
      for (let gy = startY; gy <= endY; gy++) {
        const key = `${gx},${gy}`;
        const cell = this.grid.get(key);
        if (cell) {
          results.push(...cell);
        }
      }
    }
    return results;
  }
}

export function createInitialDNA(): ManagerDNA {
  return {
    version: 1,
    lastMutationStep: 0,
    phiHarmony: 1.0,
    genes: [
      { id: 'g1', type: 'METABOLISM', sequence: 'ATGC-001', expression: 0.5, description: 'Standard Metabolic Efficiency' },
      { id: 'g2', type: 'SIGNALING', sequence: 'ATGC-002', expression: 0.5, description: 'Basic Signal Propagation' },
      { id: 'g3', type: 'STABILITY', sequence: 'ATGC-003', expression: 0.5, description: 'Structural Integrity' },
      { id: 'g4', type: 'PATTERN_SCALING', sequence: 'PHI-001', expression: 0.618, description: 'Golden Ratio Pattern Scaling' },
      { id: 'g5', type: 'RECURSION_DEPTH', sequence: 'PHI-002', expression: 0.382, description: 'Fractal Recursion Depth' },
      { id: 'g6', type: 'ADAPTATION_SPEED', sequence: 'PHI-003', expression: 0.236, description: 'Smooth Adaptation Velocity' },
      { id: 'g7', type: 'RECOVERY_AGGRESSION', sequence: 'REC-001', expression: 0.4, description: 'Autonomous Recovery Aggression' },
      { id: 'g8', type: 'STABILITY_THRESHOLD', sequence: 'STB-001', expression: 0.7, description: 'System Stability Sensitivity' },
    ]
  };
}

export function createInitialAgents(count: number): AgentState[] {
  return Array.from({ length: count }).map((_, i) => {
    const bioTemplate = BIO_DATA_POOL[Math.floor(Math.random() * BIO_DATA_POOL.length)];
    // Hierarchical structure based on Phi
    const recursionLevel = Math.floor(Math.log(i + 1) / Math.log(PHI));
    return {
      id: `agent-${i}`,
      name: `${bioTemplate.name}-${i}`,
      type: bioTemplate.type,
      policy: pickPolicyForType(bioTemplate.type),
      health: 80 + Math.random() * 20,
      energy: 50 + Math.random() * 50,
      sensitivity: 0.1 + Math.random() * 0.9,
      memory: [],
      signalHistory: [],
      phiPhase: (i * PHI * 2 * Math.PI) % (2 * Math.PI),
      recursionLevel,
      interactionRadius: 100, // Base radius
      parameters: {
        metabolismRate: 0.05 + Math.random() * 0.1,
        decayRate: 0.01 + Math.random() * 0.05,
        signalThreshold: 0.2 + Math.random() * 0.3,
        phiScaling: Math.pow(PHI, -recursionLevel), // Natural scaling
      },
      linkedProtein: bioTemplate.protein,
    };
  });
}

export function processSimulationStep(
  agents: AgentState[],
  signals: BioSignal[],
  dna: ManagerDNA,
  currentStep: number
): { nextAgents: AgentState[]; nextSignals: BioSignal[] } {
  const nextSignals: BioSignal[] = [];
  
  // Calculate global DNA modifiers
  const getModifier = (type: GeneType) => {
    const gene = dna.genes.find(g => g.type === type);
    return gene ? gene.expression : 0.5;
  };

  const metabolismMod = 0.5 + (getModifier('METABOLISM') * 1.0);
  const signalingMod = 0.5 + (getModifier('SIGNALING') * 1.0);
  const stabilityMod = 1.5 - (getModifier('STABILITY') * 1.0);
  const defenseMod = 1.5 - (getModifier('DEFENSE') * 1.0);
  
  // Phi-based modifiers
  const patternScaling = getModifier('PATTERN_SCALING') * PHI;
  const recursionLimit = Math.floor(getModifier('RECURSION_DEPTH') * 5);
  const adaptationSpeed = getModifier('ADAPTATION_SPEED') / PHI;

  // Initialize Spatial Grid for optimization
  const grid = new SpatialGrid(150); // Cell size matches max interaction radius
  agents.forEach(a => grid.insert(a));

  const nextAgents = agents.map(agent => {
    // 1. Natural Decay (Modified by DNA and Phi Scaling)
    // Smooth transition: health changes follow a curve inspired by natural growth
    const decayFactor = agent.parameters.decayRate * stabilityMod * agent.parameters.phiScaling;
    let health = agent.health - decayFactor;
    
    // Smooth energy consumption using Enhanced Flux Engine
    const fluxEfficiency = getModifier('METABOLISM');
    const computedFlux = MetabolicFluxEngine.calculateFlux(metabolismMod, 1.0, fluxEfficiency);
    let energy = agent.energy + (computedFlux * 0.01) - (agent.parameters.metabolismRate * agent.parameters.phiScaling);

    // 2. Process Incoming Signals
    // Refactor: Sort signals by priority (CRITICAL first)
    const incoming = signals
      .filter(s => s.target === agent.id)
      .sort((a, b) => b.priority - a.priority);

    const newHistoryEntries: any[] = [];
    const newMemoryEntries: string[] = [];
    let adaptedSensitivity = agent.sensitivity;

    incoming.forEach(signal => {
      // Record in history
      newHistoryEntries.push({
        type: signal.type,
        priority: signal.priority,
        isUrgent: signal.isUrgent,
        step: signal.step,
        payload: signal.payload,
      });

      // Record in memory
      newMemoryEntries.push(`Received ${signal.type} signal from ${signal.source.split('-')[0]} (Payload: ${signal.payload.toFixed(1)})`);

      // Adapt sensitivity: receiving critical/urgent signals increases sensitivity
      if (signal.priority >= SignalPriority.HIGH || signal.isUrgent) {
        adaptedSensitivity = Math.min(1.0, adaptedSensitivity + 0.05);
      } else {
        // Low priority signals slightly decrease sensitivity (habituation)
        adaptedSensitivity = Math.max(0.1, adaptedSensitivity - 0.005);
      }

      // Urgent signals have immediate effect (no integration factor)
      const integrationFactor = signal.isUrgent ? 1 : (1 - Math.exp(-adaptationSpeed));
      
      if (signal.type === 'ATP') energy += signal.payload * integrationFactor;
      if (signal.type === 'HORMONAL') health += signal.payload * 0.1 * integrationFactor;
      if (signal.type === 'CYTOKINE') health -= (signal.payload * 0.5 * defenseMod * integrationFactor);
      
      // Handle ALERT signals
      if (signal.type === 'ALERT') {
        health += signal.payload * 0.2; // Alerts trigger emergency recovery
        energy -= 2; // But cost energy
      }
    });

    // Update signal history (limit to last 20 entries)
    const updatedHistory = [...newHistoryEntries, ...agent.signalHistory].slice(0, 20);
    const updatedMemory = [...newMemoryEntries, ...agent.memory].slice(0, 10);

    // Calculate dynamic interaction radius
    // Base radius is 100, modified by health and signaling genes
    // Urgent states expand the radius
    const isEmergency = health < 30;
    const baseRadius = 100 * agent.parameters.phiScaling;
    const nextInteractionRadius =
      baseRadius
      * (1 + (signalingMod * 0.5))
      * (isEmergency ? 2.0 : 1.0)
      * policyRadiusMultiplier(agent.policy); // micro-policy modifier (Explorer = 1.2x)

    // 3. Agent Logic (Recursive & Phi-based)
    // Update Phi Phase for spiral movement/behavior
    const nextPhiPhase = (agent.phiPhase + adaptationSpeed) % (2 * Math.PI);

    // Metabolic Hubs generate ATP with recursive depth
    if (agent.type === OrganType.METABOLIC_HUB && health > 50 && energy > 20) {
      // Spatial targeting: find agents within interaction radius using Grid
      const potentialTargets = (agent.x !== undefined && agent.y !== undefined)
        ? grid.query(agent.x, agent.y, nextInteractionRadius).filter(a => {
            if (a.id === agent.id) return false;
            const distSq = Math.pow(a.x! - agent.x!, 2) + Math.pow(a.y! - agent.y!, 2);
            return distSq < Math.pow(nextInteractionRadius, 2);
          })
        : agents.filter(a => a.id !== agent.id);

      const target = potentialTargets.length > 0 
        ? potentialTargets[Math.floor(Math.random() * potentialTargets.length)]
        : agents[Math.floor(Math.random() * agents.length)];

      if (target.id !== agent.id) {
        nextSignals.push({
          id: `sig-${Date.now()}-${Math.random()}`,
          source: agent.id,
          target: target.id,
          type: 'ATP',
          payload: 5 * signalingMod * agent.parameters.phiScaling,
          timestamp: Date.now(),
          step: currentStep,
          recursionLevel: 0,
          priority: SignalPriority.NORMAL,
          isUrgent: false,
        });
        newMemoryEntries.push(`Generated ATP for ${target.name.split('-')[0]}`);
        energy -= 5;
      }
    }

    // Signal Transducers relay messages with fractal recursion
    if (agent.type === OrganType.SIGNAL_TRANSDUCER && incoming.length > 0) {
      incoming.forEach(s => {
        if (s.recursionLevel < recursionLimit) {
          // Urgent signals can propagate further (larger search radius)
          const relayRadius = nextInteractionRadius * (s.isUrgent ? 1.5 : 1.0);
          
          const potentialTargets = (agent.x !== undefined && agent.y !== undefined)
            ? grid.query(agent.x, agent.y, relayRadius).filter(a => {
                if (a.id === agent.id || a.id === s.source) return false;
                const distSq = Math.pow(a.x! - agent.x!, 2) + Math.pow(a.y! - agent.y!, 2);
                return distSq < Math.pow(relayRadius, 2);
              })
            : agents.filter(a => a.id !== agent.id && a.id !== s.source);

          const target = potentialTargets.length > 0 
            ? potentialTargets[Math.floor(Math.random() * potentialTargets.length)]
            : agents[Math.floor(Math.random() * agents.length)];

          nextSignals.push({
            id: `sig-${Date.now()}-${Math.random()}`,
            source: agent.id,
            target: target.id,
            type: 'HORMONAL',
            payload: (s.payload / (s.isUrgent ? 1.1 : PHI)) * signalingMod, // Less decay for urgent
            timestamp: Date.now(),
            step: currentStep,
            recursionLevel: s.recursionLevel + 1,
            priority: s.priority, // Maintain priority during relay
            isUrgent: s.isUrgent,
            parentId: s.id, // Set parent ID for tracing
          });
          newMemoryEntries.push(`Relayed ${s.type} to ${target.name.split('-')[0]}`);
        }
      });
    }

    // 4. Boundary Checks & Rebirth Logic
    if (health <= 0) {
      const bioTemplate = BIO_DATA_POOL[Math.floor(Math.random() * BIO_DATA_POOL.length)];
      return {
        ...agent,
        name: `${bioTemplate.name}-Reborn-${Date.now().toString().slice(-4)}`,
        type: bioTemplate.type,
        policy: pickPolicyForType(bioTemplate.type), // reroll micro-policy for the new organ type
        health: 100,
        energy: 100,
        sensitivity: 0.1 + Math.random() * 0.9,
        memory: ['Reborn after metabolic failure'],
        signalHistory: [],
        phiPhase: 0,
        interactionRadius: 100,
        parameters: {
          ...agent.parameters,
          phiScaling: Math.pow(PHI, -agent.recursionLevel),
        },
        linkedProtein: bioTemplate.protein,
      };
    }

    // 5. Emergency Signaling — gated by per-agent micro-policy
    if (shouldEmitEmergencyAlert(agent.policy, health, energy)) {
      // Alerts have double the interaction radius
      const alertRadius = nextInteractionRadius * 2;
      const neighbors = (agent.x !== undefined && agent.y !== undefined)
        ? grid.query(agent.x, agent.y, alertRadius).filter(a => {
            if (a.id === agent.id) return false;
            const distSq = Math.pow(a.x! - agent.x!, 2) + Math.pow(a.y! - agent.y!, 2);
            return distSq < Math.pow(alertRadius, 2);
          }).slice(0, 5)
        : agents.filter(a => a.id !== agent.id).slice(0, 5);

      neighbors.forEach(neighbor => {
        nextSignals.push({
          id: `alert-${Date.now()}-${Math.random()}`,
          source: agent.id,
          target: neighbor.id,
          type: 'ALERT',
          payload: 10 * signalingMod,
          timestamp: Date.now(),
          step: currentStep,
          recursionLevel: 0,
          priority: SignalPriority.CRITICAL,
          isUrgent: true,
        });
        newMemoryEntries.push(`Sent EMERGENCY ALERT to ${neighbor.name.split('-')[0]}`);
      });
      energy -= 5;
    }

    health = Math.max(0, Math.min(100, health));
    energy = Math.max(0, Math.min(200, energy));

    return { 
      ...agent, 
      health, 
      energy, 
      phiPhase: nextPhiPhase, 
      sensitivity: adaptedSensitivity,
      signalHistory: updatedHistory,
      memory: updatedMemory,
      interactionRadius: nextInteractionRadius
    };
  });

  // Limit signals to prevent explosion - use simulation steps for pruning (last 5 steps)
  const prunedSignals = [...nextSignals, ...signals.filter(s => currentStep - s.step < 5)].slice(-200);

  return { nextAgents, nextSignals: prunedSignals };
}
