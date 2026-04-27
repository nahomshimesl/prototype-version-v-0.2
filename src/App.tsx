/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from "socket.io-client";
import { AgentState, BioSignal, OrganType, SimulationMetrics, PredictionResult, MutationSuggestion, ManagerDNA, SystemHealthState, SignalPriority, TelemetryEvent, CollapseForecast } from './types/simulation';
import { forecastCollapse } from './services/CollapseForecaster';
import CollapseForecastPanel from './components/CollapseForecast';
import { createInitialAgents, processSimulationStep, createInitialDNA } from './engine/SimulationLoop';
import { getSimulationPrediction, suggestMutation } from './services/PredictionService';
import { healthEngine } from './services/HealthEngine';
import Visualizer from './components/Visualizer';
import ControlPanel from './components/ControlPanel';
import GeneticEditor from './components/GeneticEditor';
import HealthDashboard from './components/HealthDashboard';
import FullStackSimulation from './components/FullStackSimulation';
import SystemInspector from './components/SystemInspector';
import ErrorBoundary from './components/ErrorBoundary';
import { motion, AnimatePresence } from 'motion/react';
import { Microscope, Database, BrainCircuit, Network, Zap, Activity, ShieldAlert, Save, Trash2, LogIn, LogOut, Dna, Check, X, AlertTriangle, ArrowUpDown, Search, FlaskConical, Terminal, Binary, Brain, BookOpen } from 'lucide-react';
import { auth, db, googleProvider, signInWithPopup, signOut, collection, addDoc, deleteDoc, doc, onSnapshot, query, where, orderBy, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, AreaChart, Area } from 'recharts';

import TelemetryViewer from './components/TelemetryViewer';
import DataAnalyzer from './components/DataAnalyzer';
import StabilitySentinel from './components/StabilitySentinel';
import AboutPanel, { type ActiveTab } from './components/AboutPanel';
import { SentinelClient } from './services/SentinelClient';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [signals, setSignals] = useState<BioSignal[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('ABOUT');
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>([]);
  const [dna, setDna] = useState<ManagerDNA>(createInitialDNA());
  const [health, setHealth] = useState<SystemHealthState>({
    overallScore: 100,
    latency: 0,
    errorRate: 0,
    resourceUsage: 0,
    activeIncidents: [],
    history: [],
    systemLogs: []
  });
  const [metrics, setMetrics] = useState<SimulationMetrics>({
    totalAgents: 0,
    averageHealth: 0,
    entropy: 0,
    signalDensity: 0,
    step: 0,
    failureRate: 0,
    history: [],
    anomalies: [],
  });
  const [prediction, setPrediction] = useState<PredictionResult>();
  const [forecast, setForecast] = useState<CollapseForecast | null>(null);
  // Recompute the local collapse forecast every tick (fast, deterministic, no API calls).
  useEffect(() => {
    setForecast(forecastCollapse(metrics, metrics.step));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics.step, metrics.history.length, metrics.entropy]);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [mutationSuggestion, setMutationSuggestion] = useState<MutationSuggestion | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logSortOrder, setLogSortOrder] = useState<'desc' | 'asc'>('desc');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'WEEK'>('ALL');
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [showInspector, setShowInspector] = useState(false);
  const [groupingMode, setGroupingMode] = useState<'NONE' | 'TYPE' | 'HEALTH'>('NONE');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [visualizerFilter, setVisualizerFilter] = useState<Set<string>>(new Set());
  
  const mutationCooldowns = useRef<Record<string, number>>({});
  const frameCount = useRef(0);
  
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const containerObserverRef = useRef<ResizeObserver | null>(null);
  const containerRafRef = useRef<number | null>(null);
  // Callback ref: measures the simulation container synchronously the
  // moment it mounts (when user first opens the SIMULATION tab) so the
  // visualizer renders immediately instead of waiting for a timer.
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    // Tear down any previous attachment first.
    if (containerObserverRef.current) {
      containerObserverRef.current.disconnect();
      containerObserverRef.current = null;
    }
    if (containerRafRef.current != null) {
      cancelAnimationFrame(containerRafRef.current);
      containerRafRef.current = null;
    }
    containerNodeRef.current = node;
    if (!node) return;
    const measure = () => {
      // Bail out if the node was swapped out before this fired.
      if (containerNodeRef.current !== node) return;
      const { clientWidth, clientHeight } = node;
      if (clientWidth > 0 && clientHeight > 0) {
        setViewSize((prev) =>
          prev.width === clientWidth && prev.height === clientHeight
            ? prev
            : { width: clientWidth, height: clientHeight }
        );
      }
    };
    measure();
    containerRafRef.current = requestAnimationFrame(() => {
      containerRafRef.current = null;
      measure();
    });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(node);
      containerObserverRef.current = ro;
    }
  }, []);
  const lastStepTime = useRef(0);
  const lastComputeTime = useRef<number | null>(null);
  const predictionCooldown = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const isProcessingRef = useRef(false);
  const socketRef = useRef<any>(null); // Add socket ref

  // 1. Initialize Simulation & Auth
  useEffect(() => {
    // Initialize Socket.io
    socketRef.current = io();
    socketRef.current.emit("join-session", "simulation-room-1");

    // Install Stability Sentinel error capture + live event subscription
    SentinelClient.install(socketRef.current);

    socketRef.current.on("health-update", (healthUpdate: any) => {
      // Potentially update health state or logs
      console.log("Health updated via socket", healthUpdate);
    });

    socketRef.current.on("log-added", (log: any) => {
      setTelemetryEvents(prev => [...prev, {
        id: `tel-${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        type: 'SIGNAL', // Or derive from log type
        message: log.message || log.details?.message || "System event"
      }].slice(-50));
    });

    // Initialize Web Worker
    workerRef.current = new Worker(new URL('./engine/simulation.worker.ts', import.meta.url), { type: 'module' });
    
    workerRef.current.onmessage = (e) => {
      const { nextAgents, nextSignals, nextStep } = e.data;
      const now = Date.now();
      
      setAgents(nextAgents);
      setSignals(nextSignals);
      
      // Compute throughput
      const timeDelta = now - (lastComputeTime.current || now - 16);
      const stepsDone = nextStep - (metricsRef.current.step || nextStep - 1);
      const throughput = (stepsDone / timeDelta) * 1000;
      lastComputeTime.current = now;

      setHealth(h => ({ ...h, workerStatus: 'IDLE', parallelismActive: true }));

      // Generate Telemetry Events
      const newEvents: TelemetryEvent[] = [];
      if (nextSignals.length > signalsRef.current.length) {
        newEvents.push({
          id: `tel-${now}-${Math.random()}`,
          timestamp: now,
          type: 'SIGNAL',
          message: `Compute Hub processing ${nextSignals.length - signalsRef.current.length} new signaling packets in parallel`,
        });
      }

      if (nextAgents.length !== agentsRef.current.length) {
        const delta = nextAgents.length - agentsRef.current.length;
        newEvents.push({
          id: `tel-${now}-${Math.random()}`,
          timestamp: now,
          type: delta > 0 ? 'BIRTH' : 'DEATH',
          message: `${Math.abs(delta)} agents reorganized in sector ${nextStep}`,
        });
      }

      if (newEvents.length > 0) {
        setTelemetryEvents(prev => [...prev, ...newEvents].slice(-50));
      }

      // Update Metrics
      setMetrics(m => {
        const finalAvgHealth = nextAgents.length > 0 ? nextAgents.reduce((acc: number, a: AgentState) => acc + a.health, 0) / nextAgents.length : 0;
        const newHistory = [...m.history, finalAvgHealth].slice(-50);
        let failureRate = 0;
        
        if (newHistory.length > 1) {
          const deltas = [];
          for (let i = 1; i < newHistory.length; i++) {
            deltas.push(newHistory[i] - newHistory[i-1]);
          }
          failureRate = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        }

        const newAnomalies = [...m.anomalies];
        if (newHistory.length > 10) {
          const recentDeltas = [];
          for (let i = 1; i < newHistory.length; i++) {
            recentDeltas.push(newHistory[i] - newHistory[i-1]);
          }
          const mean = recentDeltas.reduce((a, b) => a + b, 0) / recentDeltas.length;
          const variance = recentDeltas.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentDeltas.length;
          const stdDev = Math.sqrt(variance);
          
          const currentDelta = finalAvgHealth - (newHistory[newHistory.length - 2] || finalAvgHealth);
          const zScore = stdDev > 0 ? Math.abs(currentDelta - mean) / stdDev : 0;

          if (zScore > 3) {
            newAnomalies.push({
              step: nextStep,
              severity: zScore,
              type: currentDelta < mean ? 'SUDDEN_DROP' : 'UNEXPECTED_SURGE'
            });
          }
        }

        const criticalAgent = nextAgents.find((a: AgentState) => a.health < 20);
        if (criticalAgent && !mutationSuggestion && !isMutating && (!mutationCooldowns.current[criticalAgent.id] || nextStep > mutationCooldowns.current[criticalAgent.id])) {
          handleTriggerMutation(criticalAgent, nextStep);
        }

        return {
          ...m,
          totalAgents: nextAgents.length,
          averageHealth: finalAvgHealth,
          signalDensity: nextAgents.length > 0 ? nextSignals.length / nextAgents.length : 0,
          step: nextStep,
          history: newHistory,
          failureRate: failureRate,
          anomalies: newAnomalies.slice(-10),
          throughput,
          memoryUsage: nextAgents.length * 512 + nextSignals.length * 128
        };
      });

      isProcessingRef.current = false;
    };

    // Initialize HealthEngine Backend
    healthEngine.setBackendConfig(true, "organoid2026");

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });

    const initialAgents = createInitialAgents(50);
    setAgents(initialAgents);
    
    // Window-resize fallback (the callback ref attaches a per-element
    // ResizeObserver which handles the common case).
    const onWindowResize = () => {
      const node = containerNodeRef.current;
      if (!node) return;
      const { clientWidth, clientHeight } = node;
      if (clientWidth > 0 && clientHeight > 0) {
        setViewSize((prev) =>
          prev.width === clientWidth && prev.height === clientHeight
            ? prev
            : { width: clientWidth, height: clientHeight }
        );
      }
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      socketRef.current?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      containerObserverRef.current?.disconnect();
      if (containerRafRef.current != null) {
        cancelAnimationFrame(containerRafRef.current);
        containerRafRef.current = null;
      }
      unsubscribeAuth();
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  // 2. Fetch Research Logs
  useEffect(() => {
    if (!user) {
      setLogs([]);
      return;
    }

    const q = query(
      collection(db, 'researchLogs'),
      where('uid', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(newLogs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'researchLogs');
    });

    return () => unsubscribe();
  }, [user]);

  const agentsRef = useRef(agents);
  const signalsRef = useRef(signals);
  const metricsRef = useRef(metrics);
  
  useEffect(() => { agentsRef.current = agents; }, [agents]);
  useEffect(() => { signalsRef.current = signals; }, [signals]);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);

  // 2. Simulation Loop
  const step = useCallback(() => {
    if (!isRunning || !workerRef.current) return;

    if (isProcessingRef.current) {
      lastStepTime.current = requestAnimationFrame(step);
      return;
    }

    frameCount.current++;
    
    let stepsToProcess = 0;
    if (simulationSpeed >= 1) {
      stepsToProcess = Math.floor(simulationSpeed);
    } else {
      const framesPerStep = Math.round(1 / simulationSpeed);
      if (frameCount.current % framesPerStep === 0) {
        stepsToProcess = 1;
      }
    }

    if (stepsToProcess === 0) {
      lastStepTime.current = requestAnimationFrame(step);
      return;
    }

    isProcessingRef.current = true;
    setHealth(h => ({ ...h, workerStatus: 'BUSY' }));

    workerRef.current.postMessage({
      agents: agentsRef.current,
      signals: signalsRef.current,
      dna,
      currentStep: metricsRef.current.step,
      stepsToProcess
    });

    lastStepTime.current = requestAnimationFrame(step);
  }, [isRunning, dna, mutationSuggestion, isMutating, simulationSpeed]);

  useEffect(() => {
    if (isRunning) {
      lastStepTime.current = requestAnimationFrame(step);
    } else {
      cancelAnimationFrame(lastStepTime.current);
    }
    return () => cancelAnimationFrame(lastStepTime.current);
  }, [isRunning, step]);

  useEffect(() => {
    if (isRunning && metrics.step > 0 && metrics.step % 10 === 0) {
      healthEngine.analyzeHealth(agents, metrics, dna).then(setHealth);
    }
  }, [metrics.step, isRunning]);

  // 3. Handlers
  const handleAddAgent = (type: OrganType) => {
    const PHI = 1.61803398875;
    const newAgent: AgentState = {
      id: `agent-${Date.now()}`,
      name: `New-${type.split(' ')[0]}-${agents.length}`,
      type,
      policy: 'REACTIVE', // user-added agents start with the default micro-policy
      health: 100,
      energy: 100,
      sensitivity: 0.5,
      memory: [],
      signalHistory: [],
      phiPhase: Math.random() * Math.PI * 2,
      recursionLevel: 0,
      interactionRadius: 100,
      parameters: {
        metabolismRate: 0.08,
        decayRate: 0.02,
        signalThreshold: 0.25,
        phiScaling: 1.0,
      },
    };
    setAgents([...agents, newAgent]);
  };

  const handleRemoveAgent = () => {
    if (agents.length === 0) return;
    const sorted = [...agents].sort((a, b) => a.health - b.health);
    setAgents(agents.filter(a => a.id !== sorted[0].id));
  };

  const handleAnalyze = async () => {
    if (isAnalyzing || cooldown > 0) return;
    setIsAnalyzing(true);
    try {
      const result = await getSimulationPrediction(agents, metrics, dna);
      setPrediction(result);
      setCooldown(30); // 30 second cooldown for safety
    } catch (error) {
      console.error("Analysis failed:", error);
      healthEngine.reportExternalError('PredictionService', 'Failed to generate system prediction', 'MEDIUM', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSimulateError = () => {
    const errors = [
      { msg: "Firebase: Error (auth/network-request-failed).", source: "AuthModule" },
      { msg: "TypeError: Cannot read properties of undefined (reading 'phiPhase')", source: "RenderEngine" },
      { msg: "Quota exceeded for quota group 'GenerateContentGroup'", source: "GeminiSDK" },
      { msg: "Failed to fetch resource: 404 Not Found", source: "NetworkLayer" }
    ];
    const error = errors[Math.floor(Math.random() * errors.length)];
    healthEngine.reportExternalError(error.source, error.msg, 'MEDIUM');
  };

  const handleTriggerMutation = async (agent: AgentState, currentStep: number) => {
    setIsMutating(true);
    // Set a long cooldown for this agent to avoid spamming
    mutationCooldowns.current[agent.id] = currentStep + 100;
    
    try {
      const suggestion = await suggestMutation(agent);
      if (suggestion.parameters && suggestion.name) {
        setMutationSuggestion({
          agentId: agent.id,
          originalName: agent.name,
          newName: suggestion.name,
          parameters: suggestion.parameters as any
        });
      }
    } catch (error) {
      console.error("Mutation suggestion failed:", error);
    } finally {
      setIsMutating(false);
    }
  };

  const handleApproveMutation = () => {
    if (!mutationSuggestion) return;
    
    setAgents(prev => prev.map(a => {
      if (a.id === mutationSuggestion.agentId) {
        return {
          ...a,
          name: mutationSuggestion.newName,
          health: Math.min(100, a.health + 30), // Boost health on successful mutation
          parameters: {
            ...a.parameters,
            ...mutationSuggestion.parameters
          }
        };
      }
      return a;
    }));
    
    setMutationSuggestion(null);
  };

  const handleRejectMutation = () => {
    setMutationSuggestion(null);
  };

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  // 4. Autonomous Recovery Handler
  useEffect(() => {
    const pendingIncidents = health.activeIncidents.filter(i => i.status === 'RESOLVED' && !i.isApplied);
    if (pendingIncidents.length === 0) return;

    pendingIncidents.forEach(incident => {
      if (incident.recommendedAction === 'RESTART_AGENTS') {
        setAgents(prev => prev.map(a => 
          incident.affectedAgents.includes(a.id) ? { ...a, health: 100 } : a
        ));
      } else if (incident.recommendedAction === 'ROLLBACK_DNA') {
        // Simple rollback: reset to initial DNA for now
        setDna(createInitialDNA());
      } else if (incident.recommendedAction === 'ADJUST_PARAMETERS') {
        // This would ideally use the dnaAdjustments from the LLM, but for now we'll just nudge DNA
        setDna(prev => ({
          ...prev,
          metabolismRate: prev.metabolismRate * 0.9,
          decayRate: prev.decayRate * 1.1
        }));
      }

      // Mark as applied
      setHealth(prev => ({
        ...prev,
        activeIncidents: prev.activeIncidents.map(i => 
          i.id === incident.id ? { ...i, isApplied: true } : i
        )
      }));
    });
  }, [health.activeIncidents]);

  const handleReset = () => {
    setAgents(createInitialAgents(50));
    setSignals([]);
    setDna(createInitialDNA());
    setGroupingMode('NONE');
    setCollapsedGroups(new Set());
    setVisualizerFilter(new Set());
    setTelemetryEvents([]);
    lastComputeTime.current = null;
    setMetrics({
      totalAgents: 50,
      averageHealth: 90,
      entropy: 0,
      signalDensity: 0,
      step: 0,
      failureRate: 0,
      history: [],
      anomalies: [],
      throughput: 0,
      memoryUsage: 0
    });
    setPrediction(undefined);
  };

  const filteredResearchLogs = useMemo(() => {
    return logs
      .filter(log => {
        const matchesSearch = log.notes?.toLowerCase().includes(logSearch.toLowerCase()) || 
                             log.id.toLowerCase().includes(logSearch.toLowerCase());
        
        let matchesDate = true;
        if (dateFilter === 'TODAY') {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          matchesDate = new Date(log.timestamp) >= today;
        } else if (dateFilter === 'WEEK') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          matchesDate = new Date(log.timestamp) >= weekAgo;
        }
        
        return matchesSearch && matchesDate;
      })
      .sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return logSortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [logs, logSearch, logSortOrder, dateFilter]);

  const handleResolveIncident = (id: string) => {
    setHealth(prev => ({
      ...prev,
      activeIncidents: prev.activeIncidents.filter(i => i.id !== id)
    }));
  };

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        setLoginError("The login popup was blocked by your browser. Please allow popups for this site and try again.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        setLoginError("Login was cancelled because another login attempt was started.");
      } else if (error.code === 'auth/popup-closed-by-user') {
        setLoginError("Login popup was closed before completion. Please try again.");
      } else {
        console.error("Login failed:", error);
        setLoginError("An unexpected error occurred during login. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleSaveLog = async () => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'researchLogs'), {
        timestamp: new Date().toISOString(),
        metrics: {
          totalAgents: metrics.totalAgents,
          averageHealth: metrics.averageHealth,
          failureRate: metrics.failureRate,
          step: metrics.step
        },
        uid: user.uid,
        notes: `Snapshot at step ${metrics.step}`
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'researchLogs');
    }
  };

  const handleDeleteLog = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'researchLogs', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `researchLogs/${id}`);
    }
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleVisualizerFilter = (groupId: string) => {
    setVisualizerFilter(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const groupedAgents = useMemo<Record<string, AgentState[]>>(() => {
    if (groupingMode === 'NONE') return { 'All Agents': agents };
    
    const groups: Record<string, AgentState[]> = {};
    agents.forEach(agent => {
      let key = '';
      if (groupingMode === 'TYPE') {
        key = agent.type;
      } else {
        if (agent.health <= 30) key = 'CRITICAL';
        else if (agent.health <= 70) key = 'WARNING';
        else key = 'STABLE';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(agent);
    });
    return groups;
  }, [agents, groupingMode]);

  const filteredAgentsForVisualizer = useMemo(() => {
    if (visualizerFilter.size === 0) return agents;
    
    return agents.filter(agent => {
      if (groupingMode === 'TYPE') {
        return !visualizerFilter.has(agent.type);
      } else if (groupingMode === 'HEALTH') {
        let key = '';
        if (agent.health <= 30) key = 'CRITICAL';
        else if (agent.health <= 70) key = 'WARNING';
        else key = 'STABLE';
        return !visualizerFilter.has(key);
      }
      return true;
    });
  }, [agents, groupingMode, visualizerFilter]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-emerald-950 text-emerald-50 font-sans overflow-hidden">
      {/* Sidebar Navigation — hidden on phones; the top nav is the entry point on small screens */}
      <div className="hidden md:flex w-20 bg-emerald-900 flex-col items-center py-8 gap-8 border-r border-emerald-800">
        <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <Microscope className="text-white" size={24} />
        </div>
        <nav className="flex flex-col gap-6">
          <button
            onClick={() => setActiveTab('ABOUT')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'ABOUT'
                ? 'bg-emerald-800 text-amber-300 shadow-inner'
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="About this software"
          >
            <BookOpen size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('SIMULATION')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'SIMULATION' 
                ? 'bg-emerald-800 text-emerald-400 shadow-inner' 
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Simulation View"
          >
            <Network size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('POPULATION')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'POPULATION' 
                ? 'bg-emerald-800 text-emerald-400 shadow-inner' 
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Population View"
          >
            <Activity size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('ANALYSIS')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'ANALYSIS' 
                ? 'bg-emerald-800 text-emerald-400 shadow-inner' 
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Statistical Analysis"
          >
            <Brain size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('GENETICS')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'GENETICS' 
                ? 'bg-emerald-800 text-emerald-400 shadow-inner' 
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Genetic Manager"
          >
            <Dna size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('TELEMETRY')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'TELEMETRY' 
                ? 'bg-emerald-800 text-emerald-400 shadow-inner' 
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Compute Telemetry"
          >
            <Binary size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('HEALTH')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'HEALTH' 
                ? 'bg-emerald-800 text-rose-400 shadow-inner' 
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Health Engine"
          >
            <ShieldAlert size={20} />
          </button>
          <button
            onClick={() => setActiveTab('SENTINEL')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'SENTINEL'
                ? 'bg-emerald-800 text-emerald-300 shadow-inner'
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Stability Sentinel"
          >
            <ShieldAlert size={20} className="opacity-90" />
          </button>
          <button 
            onClick={() => setActiveTab('FULLSTACK')}
            className={`p-3 rounded-xl transition-all ${
              activeTab === 'FULLSTACK' 
                ? 'bg-indigo-900 text-indigo-400 shadow-inner' 
                : 'text-emerald-500 hover:text-emerald-300'
            }`}
            title="Full-Stack Prototype"
          >
            <FlaskConical size={20} />
          </button>
        </nav>
      </div>

      {/* Main Simulation Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        <header className="md:h-20 border-b border-emerald-800 bg-emerald-900/50 backdrop-blur-md flex flex-col md:flex-row md:items-center md:justify-between px-4 md:px-8 py-3 md:py-0 gap-3 md:gap-0">
          <div className="flex items-center gap-3 md:gap-0 md:block">
            {/* Logo shown on mobile (sidebar is hidden) */}
            <div className="md:hidden w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0">
              <Microscope className="text-white" size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-2xl font-bold tracking-tight text-emerald-50 truncate">Bio-Organoid Simulation System</h1>
              <p className="text-[10px] md:text-xs font-medium text-emerald-500 uppercase tracking-widest">Research Environment v1.0.4</p>
            </div>
          </div>
          <div className="flex gap-2 md:gap-4 items-center w-full md:w-auto overflow-x-auto no-scrollbar">
            <nav className="flex items-center bg-emerald-800/50 p-1 rounded-xl md:mr-4 shrink-0">
              <button
                onClick={() => setActiveTab('ABOUT')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'ABOUT'
                    ? 'bg-amber-400 text-emerald-950 shadow-sm'
                    : 'text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <BookOpen size={14} /> About
              </button>
              <button
                onClick={() => setActiveTab('SIMULATION')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'SIMULATION' 
                    ? 'bg-emerald-500 text-white shadow-sm' 
                    : 'text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <Activity size={14} /> Simulation
              </button>
              <button
                onClick={() => setActiveTab('POPULATION')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'POPULATION' 
                    ? 'bg-emerald-500 text-white shadow-sm' 
                    : 'text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <Microscope size={14} /> Population
              </button>
              <button
                onClick={() => setActiveTab('GENETICS')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'GENETICS' 
                    ? 'bg-emerald-500 text-white shadow-sm' 
                    : 'text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <Dna size={14} /> Genetic Manager
              </button>
              <button
                onClick={() => setActiveTab('HEALTH')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'HEALTH' 
                    ? 'bg-rose-500 text-white shadow-sm' 
                    : 'text-emerald-400 hover:text-emerald-200'
                }`}
              >
                <ShieldAlert size={14} /> Health Engine
              </button>
            </nav>
            {user ? (
              <div className="flex items-center gap-2 md:gap-4 shrink-0">
                <div className="hidden lg:flex flex-col items-end">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase">Researcher</span>
                  <span className="text-sm font-bold text-emerald-50">{user.displayName}</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2 text-emerald-400 hover:text-rose-500 transition-colors"
                  title="Logout"
                >
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <button 
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  className={`flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-all ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <LogIn size={18} />
                  {isLoggingIn ? 'Connecting...' : 'Researcher Login'}
                </button>
                {loginError && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute top-full right-0 mt-2 w-64 p-3 bg-emerald-900 border border-emerald-800 rounded-xl shadow-lg z-50"
                  >
                    <div className="flex items-start gap-2 text-rose-400">
                      <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                      <p className="text-[10px] font-medium leading-tight">{loginError}</p>
                    </div>
                    <button 
                      onClick={() => setLoginError(null)}
                      className="mt-2 text-[10px] font-bold text-emerald-400 hover:text-emerald-200 underline"
                    >
                      Dismiss
                    </button>
                  </motion.div>
                )}
              </div>
            )}
            <div className="hidden lg:block h-8 w-px bg-emerald-800 mx-2" />
            <div className="hidden lg:flex flex-col items-end shrink-0">
              <span className="text-[10px] font-bold text-emerald-400 uppercase">System Entropy</span>
              <span className="text-sm font-mono font-bold text-emerald-400">LOW STABILITY</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            {activeTab === 'SIMULATION' ? (
              <motion.div
                key="simulation"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="h-full p-4 md:p-8 overflow-y-auto flex flex-col gap-4 md:gap-6"
              >
                <div className="min-h-[320px] md:min-h-[450px] h-[50vh] flex-1 relative bg-emerald-950 rounded-3xl border border-emerald-800 overflow-hidden shadow-2xl" ref={containerRef}>
            {viewSize.width > 0 && viewSize.height > 0 ? (
              <Visualizer 
                agents={filteredAgentsForVisualizer} 
                signals={signals} 
                width={viewSize.width} 
                height={viewSize.height} 
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-emerald-700">
                <div className="flex flex-col items-center gap-2">
                  <Activity className="animate-spin" size={24} />
                  <span className="text-xs font-bold uppercase tracking-widest">Initializing Environment...</span>
                </div>
              </div>
            )}
            
            <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-none">
              {health.activeIncidents.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-rose-500/90 backdrop-blur-md text-white p-3 rounded-2xl shadow-lg flex items-center gap-3 pointer-events-auto cursor-pointer"
                  onClick={() => setActiveTab('HEALTH')}
                >
                  <ShieldAlert size={18} />
                  <div className="text-[10px] font-bold uppercase tracking-widest">
                    {health.activeIncidents.length} Critical Alerts
                  </div>
                </motion.div>
              )}
            </div>

            <div className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-full shadow-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Live Viewport: {viewSize.width}x{viewSize.height}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-slate-400 animate-bounce py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest">Scroll for Analytics</span>
            <Activity size={12} />
          </div>
          
          {/* Regression & Anomaly Visualization */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="text-indigo-500" size={20} />
                  <h3 className="font-bold text-slate-900">Health Regression Analysis</h3>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span className="text-slate-500">System Health</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-slate-500">Anomalies</span>
                  </div>
                </div>
              </div>
              
              <div className="h-64 w-full relative">
                {metrics.history.length < 2 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                    <Activity size={32} className="animate-pulse mb-2" />
                    <p className="text-xs font-bold uppercase tracking-widest">Collecting Metabolic Data</p>
                    <p className="text-[10px] mt-1">Start simulation to begin regression analysis</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics.history.map((h, i) => ({ step: i, health: h }))}>
                      <defs>
                        <linearGradient id="colorHealth" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="step" hide />
                      <YAxis domain={[0, 100]} hide />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        labelStyle={{ display: 'none' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="health" 
                        stroke="#6366f1" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorHealth)" 
                      />
                      {metrics.anomalies.map((a, i) => (
                        <ReferenceLine 
                          key={i} 
                          x={a.step % 50} 
                          stroke="#ef4444" 
                          strokeDasharray="3 3" 
                          label={{ position: 'top', value: '!', fill: '#ef4444', fontSize: 12, fontWeight: 'bold' }} 
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="text-rose-500" size={20} />
                <h3 className="font-bold text-slate-900">Anomaly Detection</h3>
              </div>
              
              <div className="flex-1 flex flex-col gap-3">
                {metrics.anomalies.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 mb-3">
                      <ShieldAlert size={24} />
                    </div>
                    <p className="text-xs font-bold text-slate-900">System Stable</p>
                    <p className="text-[10px] text-slate-500 mt-1">No significant deviations detected in the current cycle.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {metrics.anomalies.slice().reverse().map((a, i) => (
                      <div key={i} className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">{a.type.replace('_', ' ')}</span>
                          <span className="text-xs font-medium text-rose-900">Step {a.step}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-bold text-rose-400 uppercase">Severity</div>
                          <div className="text-sm font-bold text-rose-600">{a.severity.toFixed(2)}σ</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <p className="text-[10px] font-medium text-indigo-700 leading-relaxed">
                  <b>Model:</b> Z-Score Analysis on Metabolic Flux. Detecting deviations exceeding 3 standard deviations from the rolling mean.
                </p>
              </div>
            </div>
          </div>

          {/* Mutation Suggestion Modal */}
          <AnimatePresence>
            {mutationSuggestion && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="fixed bottom-32 left-1/2 -translate-x-1/2 w-full max-w-md bg-slate-900 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl z-50 overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-indigo-500" />
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-400 shrink-0">
                    <Dna size={24} className="animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Mutation Detected</h3>
                      <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">CRITICAL HEALTH</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed mb-4">
                      Agent <b className="text-white">{mutationSuggestion.originalName}</b> is undergoing spontaneous genetic drift. 
                      Suggested adaptation: <b className="text-emerald-400">{mutationSuggestion.newName}</b>.
                    </p>
                    
                    <div className="grid grid-cols-3 gap-2 mb-6">
                      <div className="p-2 bg-slate-800 rounded-xl border border-slate-700">
                        <div className="text-[8px] font-bold text-slate-500 uppercase mb-1">Metabolism</div>
                        <div className="text-[10px] font-mono text-emerald-400">{mutationSuggestion.parameters.metabolismRate.toFixed(3)}</div>
                      </div>
                      <div className="p-2 bg-slate-800 rounded-xl border border-slate-700">
                        <div className="text-[8px] font-bold text-slate-500 uppercase mb-1">Decay</div>
                        <div className="text-[10px] font-mono text-emerald-400">{mutationSuggestion.parameters.decayRate.toFixed(3)}</div>
                      </div>
                      <div className="p-2 bg-slate-800 rounded-xl border border-slate-700">
                        <div className="text-[8px] font-bold text-slate-500 uppercase mb-1">Threshold</div>
                        <div className="text-[10px] font-mono text-emerald-400">{mutationSuggestion.parameters.signalThreshold.toFixed(3)}</div>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button 
                        onClick={handleApproveMutation}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-emerald-500/20"
                      >
                        <Check size={14} />
                        Apply Mutation
                      </button>
                      <button 
                        onClick={handleRejectMutation}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs transition-all"
                      >
                        <X size={14} />
                        Discard
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                <Network size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Active Nodes</div>
                <div className="text-lg font-bold text-slate-900">{agents.length}</div>
              </div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
                <Zap size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Signal Density</div>
                <div className="text-lg font-bold text-slate-900">{metrics.signalDensity.toFixed(2)}</div>
              </div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                <Activity size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Metabolic Flux</div>
                <div className="text-lg font-bold text-slate-900">0.84 μmol/s</div>
              </div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${metrics.failureRate < 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                <Activity size={20} />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Regression Rate</div>
                <div className={`text-lg font-bold ${metrics.failureRate < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {metrics.failureRate > 0 ? '+' : ''}{metrics.failureRate.toFixed(3)}%/step
                </div>
              </div>
            </div>
          </div>

          {/* Research Logs Section */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col gap-4 max-h-[500px] overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="text-indigo-500" size={20} />
                <h3 className="font-bold text-slate-900">Research Logs</h3>
              </div>
              <div className="flex items-center gap-3">
                {user && (
                  <button 
                    onClick={handleSaveLog}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-xl font-bold text-xs hover:bg-indigo-600 transition-all"
                  >
                    <Save size={14} />
                    Save Snapshot
                  </button>
                )}
              </div>
            </div>

            {user && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input 
                    type="text"
                    placeholder="Search notes..."
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
                <select 
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as any)}
                  className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-600 focus:outline-none focus:border-indigo-500 transition-all"
                >
                  <option value="ALL">All Time</option>
                  <option value="TODAY">Last 24 Hours</option>
                  <option value="WEEK">Last 7 Days</option>
                </select>
                <button 
                  onClick={() => setLogSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                  className="flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-600 hover:bg-slate-100 transition-all"
                >
                  <ArrowUpDown size={14} />
                  {logSortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
                </button>
              </div>
            )}
            
            {!user ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm italic">
                Login to save and manage research logs.
              </div>
            ) : filteredResearchLogs.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm italic">
                No logs found matching your criteria.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="grid grid-cols-1 gap-2">
                  {filteredResearchLogs.map((log) => (
                    <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="text-[10px] font-mono bg-slate-200 px-2 py-1 rounded text-slate-600">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </div>
                        <div className="flex gap-4 text-xs">
                          <span className="text-slate-500">Nodes: <b className="text-slate-900">{log.metrics.totalAgents}</b></span>
                          <span className="text-slate-500">Health: <b className="text-slate-900">{log.metrics.averageHealth.toFixed(1)}%</b></span>
                          <span className="text-slate-500">Reg: <b className={log.metrics.failureRate < 0 ? 'text-rose-600' : 'text-emerald-600'}>{log.metrics.failureRate.toFixed(3)}</b></span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDeleteLog(log.id)}
                        className="p-2 text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      ) : activeTab === 'POPULATION' ? (
        <motion.div
                key="population"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="h-full p-8 overflow-y-auto"
              >
                <div className="max-w-6xl mx-auto">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-2xl font-bold text-emerald-50">Organoid Population</h2>
                      <p className="text-emerald-400 text-sm">Real-time status of all active biological agents</p>
                    </div>
                    <div className="flex gap-4 items-center">
                      <div className="flex bg-emerald-900 border border-emerald-800 rounded-xl p-1 mr-4">
                        <button 
                          onClick={() => setGroupingMode('NONE')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${groupingMode === 'NONE' ? 'bg-emerald-500 text-white' : 'text-emerald-500 hover:bg-emerald-800'}`}
                        >
                          None
                        </button>
                        <button 
                          onClick={() => setGroupingMode('TYPE')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${groupingMode === 'TYPE' ? 'bg-emerald-500 text-white' : 'text-emerald-500 hover:bg-emerald-800'}`}
                        >
                          Type
                        </button>
                        <button 
                          onClick={() => setGroupingMode('HEALTH')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${groupingMode === 'HEALTH' ? 'bg-emerald-500 text-white' : 'text-emerald-500 hover:bg-emerald-800'}`}
                        >
                          Health
                        </button>
                      </div>
                      <div className="bg-emerald-900/50 border border-emerald-800 p-4 rounded-2xl">
                        <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Total Population</div>
                        <div className="text-2xl font-mono font-bold text-emerald-50">{agents.length}</div>
                      </div>
                      <div className="bg-emerald-900/50 border border-emerald-800 p-4 rounded-2xl">
                        <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Avg. Health</div>
                        <div className="text-2xl font-mono font-bold text-emerald-400">{metrics.averageHealth.toFixed(1)}%</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-8 pb-12">
                    {(Object.entries(groupedAgents) as [string, AgentState[]][]).map(([groupName, groupAgents]) => (
                      <div key={groupName} className="space-y-4">
                        <div className="flex items-center justify-between bg-emerald-900/20 p-4 rounded-2xl border border-emerald-800/50">
                          <div className="flex items-center gap-4">
                            <button 
                              onClick={() => toggleGroupCollapse(groupName)}
                              className="p-1 hover:bg-emerald-800 rounded transition-colors text-emerald-500"
                            >
                              <motion.div animate={{ rotate: collapsedGroups.has(groupName) ? -90 : 0 }}>
                                <ArrowUpDown size={16} />
                              </motion.div>
                            </button>
                            <h3 className="font-bold text-emerald-50 uppercase tracking-widest flex items-center gap-2">
                              {groupName} <span className="text-emerald-600 font-mono text-sm ml-2">[{groupAgents.length}]</span>
                            </h3>
                          </div>
                          {groupingMode !== 'NONE' && (
                            <button 
                              onClick={() => toggleVisualizerFilter(groupName)}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all border ${
                                visualizerFilter.has(groupName) 
                                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' 
                                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              }`}
                            >
                              {visualizerFilter.has(groupName) ? (
                                <><X size={12} /> Hidden</>
                              ) : (
                                <><Check size={12} /> Visible</>
                              )}
                            </button>
                          )}
                        </div>

                        {!collapsedGroups.has(groupName) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {groupAgents.map(agent => (
                              <motion.div 
                                key={agent.id}
                                layoutId={agent.id}
                                className="bg-emerald-900/30 border border-emerald-800 p-4 rounded-2xl hover:border-emerald-600 transition-all group relative overflow-hidden"
                              >
                                {visualizerFilter.has(groupName) && groupingMode !== 'NONE' && (
                                  <div className="absolute inset-0 bg-emerald-950/40 backdrop-blur-[1px] pointer-events-none z-10" />
                                )}
                                <div className="flex items-start justify-between mb-4">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                      agent.type === OrganType.METABOLIC_HUB ? 'bg-emerald-500/20 text-emerald-400' :
                                      agent.type === OrganType.SIGNAL_TRANSDUCER ? 'bg-blue-500/20 text-blue-400' :
                                      agent.type === OrganType.RESOURCE_COLLECTOR ? 'bg-cyan-500/20 text-cyan-400' :
                                      'bg-slate-500/20 text-slate-400'
                                    }`}>
                                      <Microscope size={20} />
                                    </div>
                                    <div className="z-20">
                                      <div className="text-sm font-bold text-emerald-50 truncate w-32">{agent.name}</div>
                                      <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">{agent.type}</div>
                                    </div>
                                  </div>
                                  <div className={`text-xs font-mono font-bold z-20 ${agent.health > 70 ? 'text-emerald-400' : agent.health > 30 ? 'text-amber-400' : 'text-rose-400'}`}>
                                    {agent.health.toFixed(0)}%
                                  </div>
                                </div>

                                <div className="space-y-3 z-20 relative">
                                  <div>
                                    <div className="flex justify-between text-[10px] font-bold text-emerald-600 uppercase mb-1">
                                      <span>Energy</span>
                                      <span>{agent.energy.toFixed(0)}/200</span>
                                    </div>
                                    <div className="h-1.5 bg-emerald-950 rounded-full overflow-hidden">
                                      <motion.div animate={{ width: `${(agent.energy / 200) * 100}%` }} className="h-full bg-emerald-500" />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] font-bold text-emerald-600 uppercase mb-1">
                                      <span>Health</span>
                                    </div>
                                    <div className="h-1.5 bg-emerald-950 rounded-full overflow-hidden">
                                      <motion.div animate={{ width: `${agent.health}%` }} className={`h-full ${agent.health > 70 ? 'bg-emerald-500' : agent.health > 30 ? 'bg-amber-500' : 'bg-rose-500'}`} />
                                    </div>
                                  </div>
                                </div>

                                {agent.signalHistory && agent.signalHistory.length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-emerald-800/50">
                                    <div className="text-[9px] font-bold text-emerald-700 uppercase tracking-widest mb-1.5 flex justify-between">
                                      <span>Signals</span>
                                      <span className="text-blue-500">{(agent.sensitivity * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                                      {agent.signalHistory.slice(0, 10).map((sig, idx) => (
                                        <div 
                                          key={idx}
                                          className={`flex-shrink-0 w-2 h-2 rounded-full ${
                                            sig.type === 'ALERT' ? 'bg-rose-500' :
                                            sig.priority === SignalPriority.CRITICAL ? 'bg-rose-600' :
                                            sig.priority === SignalPriority.HIGH ? 'bg-amber-500' :
                                            'bg-emerald-500'
                                          }`}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'FULLSTACK' ? (
              <motion.div
                key="fullstack"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-full"
              >
                <FullStackSimulation />
              </motion.div>
            ) : activeTab === 'GENETICS' ? (
              <motion.div
                key="genetics"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto"
              >
                <GeneticEditor dna={dna} onUpdateDNA={setDna} />
              </motion.div>
            ) : activeTab === 'HEALTH' ? (
              <motion.div
                key="health"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="h-full overflow-hidden"
              >
                <div className="h-full overflow-y-auto space-y-4 pr-2">
                  <CollapseForecastPanel forecast={forecast} />
                  <HealthDashboard health={health} onResolveIncident={handleResolveIncident} />
                </div>
              </motion.div>
            ) : activeTab === 'ANALYSIS' ? (
              <motion.div
                key="analysis"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="h-full overflow-hidden"
              >
                <DataAnalyzer agents={agents} signals={signals} dna={dna} />
              </motion.div>
            ) : activeTab === 'TELEMETRY' ? (
              <motion.div
                key="telemetry"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="h-full overflow-hidden"
              >
                <TelemetryViewer metrics={metrics} events={telemetryEvents} />
              </motion.div>
            ) : activeTab === 'SENTINEL' ? (
              <motion.div
                key="sentinel"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className="h-full overflow-y-auto p-4"
              >
                <StabilitySentinel />
              </motion.div>
            ) : activeTab === 'ABOUT' ? (
              <motion.div
                key="about"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="h-full overflow-hidden"
              >
                <AboutPanel onJump={setActiveTab} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {showInspector && (
          <SystemInspector 
            health={health} 
            onClose={() => setShowInspector(false)} 
          />
        )}
      </AnimatePresence>

      <button 
        onClick={() => setShowInspector(true)}
        className="fixed bottom-6 left-6 p-3 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-full text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 shadow-2xl transition-all z-40 group"
      >
        <Terminal size={20} />
        <span className="absolute left-full ml-3 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          System Inspector
        </span>
      </button>

      {/* Right Control Panel */}
      <ControlPanel
        metrics={metrics}
        isRunning={isRunning}
        onToggle={() => setIsRunning(!isRunning)}
        onReset={handleReset}
        onAddAgent={handleAddAgent}
        onRemoveAgent={handleRemoveAgent}
        prediction={prediction}
        onAnalyze={handleAnalyze}
        isAnalyzing={isAnalyzing}
        cooldown={cooldown}
        onSimulateError={handleSimulateError}
        simulationSpeed={simulationSpeed}
        onSpeedChange={setSimulationSpeed}
      />
    </div>
    </ErrorBoundary>
  );
}
