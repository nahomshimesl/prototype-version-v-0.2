import React, { useEffect, useState } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Microscope, Zap, ShieldAlert, BrainCircuit, AlertTriangle, LogIn, LogOut, Send, Activity, FlaskConical, Thermometer, Droplets } from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, googleProvider, signInWithPopup, signOut } from '../firebase';

interface SimulationResult {
  healthScore: number;
  bottlenecks: string[];
  fluxRate: string;
  timestamp: string;
  parameters: {
    glucose: number;
    oxygen: number;
    aminoAcids: number;
    temperature: number;
  };
}

const FullStackSimulation: React.FC = () => {
  // Operator identity is now per-user Firebase Auth — no more shared password.
  const [user, setUser] = useState<User | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(true);
  const [operatorEmail, setOperatorEmail] = useState<string | null>(null);
  const [loginError, setLoginError] = useState('');

  const [glucose, setGlucose] = useState(5);
  const [oxygen, setOxygen] = useState(8);
  const [aminoAcids, setAminoAcids] = useState(4);
  const [temperature, setTemperature] = useState(37);

  const [isSimulating, setIsSimulating] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const isLoggedIn = user !== null && operatorEmail !== null;

  // Watch Firebase auth state and verify operator allow-list membership
  // against the server. We deliberately verify on the server rather than
  // trusting any client-side flag, so the allow-list lives in one place.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoginError('');
      if (!u) {
        setOperatorEmail(null);
        setIsAuthorizing(false);
        return;
      }
      setIsAuthorizing(true);
      try {
        const token = await u.getIdToken();
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          setOperatorEmail(data?.email ?? u.email ?? '(unknown)');
        } else {
          setOperatorEmail(null);
          setLoginError(
            'Your account is not on the operator allow-list. Ask an admin to add your email.',
          );
        }
      } catch {
        setOperatorEmail(null);
        setLoginError('Could not verify operator status. Check your connection and try again.');
      } finally {
        setIsAuthorizing(false);
      }
    });
    return () => unsub();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError('');
    try {
      await signInWithPopup(auth, googleProvider);
      // The onAuthStateChanged effect above runs the operator check.
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked') {
        setLoginError('Popup blocked by your browser. Allow popups for this site and try again.');
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setLoginError('Sign-in popup was closed before completion.');
      } else {
        setLoginError('Sign-in failed. Please try again.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  };

  const runSimulation = async () => {
    setIsSimulating(true);
    setAiAnalysis(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('Not signed in.');
      const token = await u.getIdToken();
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ glucose, oxygen, aminoAcids, temperature })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Simulation failed: ${response.status} ${text}`);
      }
      const data = await response.json();
      setResult(data);

      // Automatically trigger AI analysis
      analyzeWithAI(data);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSimulating(false);
    }
  };

  const analyzeWithAI = async (simData: SimulationResult) => {
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: (process.env.GEMINI_API_KEY as string) });
      const prompt = `Analyze this biological simulation data and predict potential system failure:
        - Health Score: ${simData.healthScore}%
        - Metabolic Flux: ${simData.fluxRate} μmol/s
        - Bottlenecks: ${simData.bottlenecks.join(', ') || 'None'}
        - Parameters: Glucose ${simData.parameters.glucose}, Oxygen ${simData.parameters.oxygen}, Amino Acids ${simData.parameters.aminoAcids}, Temp ${simData.parameters.temperature}°C
        
        Provide a concise prediction of failure risk (Low/Medium/High) and suggested corrective actions.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setAiAnalysis(response.text || "Analysis unavailable.");
    } catch (error) {
      console.error("AI Analysis failed:", error);
      setAiAnalysis("AI analysis failed to generate. Check your API configuration.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!isLoggedIn) {
    const signedInButNotAllowed = user !== null && operatorEmail === null && !isAuthorizing;
    return (
      <div className="flex items-center justify-center h-full bg-emerald-950 p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-emerald-900/50 border border-emerald-800 p-8 rounded-3xl shadow-2xl backdrop-blur-xl"
        >
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <ShieldAlert className="text-white" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Operator Sign-In</h2>
            <p className="text-emerald-400 text-sm text-center">
              Operator access is per-user. Sign in with a Google account on the operator allow-list to initialize the full-stack simulation engine.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <p className="text-rose-400 text-xs font-medium bg-rose-950/40 border border-rose-900/60 rounded-xl px-3 py-2">
                {loginError}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoggingIn || isAuthorizing}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <LogIn size={18} />
              {isAuthorizing ? 'Verifying operator status…' : isLoggingIn ? 'Opening Google sign-in…' : 'Sign in with Google'}
            </button>
            {signedInButNotAllowed && (
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full py-2 text-emerald-300 hover:text-emerald-100 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <LogOut size={14} /> Sign out ({user?.email})
              </button>
            )}
          </form>
          <p className="text-[10px] text-emerald-700 mt-6 text-center uppercase tracking-widest">
            Operator allow-list managed via OPERATOR_EMAILS — see DEPLOY.md
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-emerald-950 p-6 gap-6 overflow-y-auto custom-scrollbar">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
            <FlaskConical className="text-emerald-950" size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Metabolic Flux Engine</h2>
            <p className="text-[10px] text-emerald-500 uppercase tracking-widest">Full-Stack Prototype v1.0</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-900/50 border border-emerald-800 rounded-full">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
              Operator: {operatorEmail}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            className="p-1.5 rounded-full bg-emerald-900/50 border border-emerald-800 text-emerald-400 hover:text-white hover:bg-emerald-800/60 transition-colors"
          >
            <LogOut size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Form */}
        <div className="bg-emerald-900/30 border border-emerald-800 p-6 rounded-3xl flex flex-col gap-6">
          <h3 className="text-xs font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-2">
            <Activity size={14} /> Simulation Parameters
          </h3>
          
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-emerald-400 flex items-center gap-2"><Droplets size={12} /> Glucose Level</span>
                <span className="text-white font-mono">{glucose} mmol/L</span>
              </div>
              <input 
                type="range" min="0" max="10" step="0.1"
                value={glucose} onChange={(e) => setGlucose(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-emerald-400 flex items-center gap-2"><Zap size={12} /> Oxygen Saturation</span>
                <span className="text-white font-mono">{oxygen} kPa</span>
              </div>
              <input 
                type="range" min="0" max="20" step="0.1"
                value={oxygen} onChange={(e) => setOxygen(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-emerald-400 flex items-center gap-2"><Microscope size={12} /> Amino Acid Density</span>
                <span className="text-white font-mono">{aminoAcids} g/L</span>
              </div>
              <input 
                type="range" min="0" max="10" step="0.1"
                value={aminoAcids} onChange={(e) => setAminoAcids(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-emerald-400 flex items-center gap-2"><Thermometer size={12} /> Temperature</span>
                <span className="text-white font-mono">{temperature}°C</span>
              </div>
              <input 
                type="range" min="30" max="45" step="0.1"
                value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>

          <button 
            onClick={runSimulation}
            disabled={isSimulating}
            className="mt-4 py-4 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 disabled:opacity-50"
          >
            {isSimulating ? <Activity className="animate-spin" size={20} /> : <Send size={20} />}
            {isSimulating ? 'Processing Backend Simulation...' : 'Execute Simulation'}
          </button>
        </div>

        {/* Results & AI Analysis */}
        <div className="flex flex-col gap-6">
          <AnimatePresence mode="wait">
            {!result ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-emerald-900/10 border border-dashed border-emerald-800 rounded-3xl"
              >
                <FlaskConical className="text-emerald-800 mb-4" size={48} />
                <p className="text-sm text-emerald-700 font-medium">Waiting for simulation data...</p>
                <p className="text-[10px] text-emerald-800 mt-2 uppercase tracking-widest">Adjust parameters and execute</p>
              </motion.div>
            ) : (
              <motion.div 
                key="results"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col gap-6"
              >
                <div className="bg-white rounded-3xl p-6 shadow-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Simulation Output</h3>
                    <span className="text-[10px] font-mono text-slate-400">{new Date(result.timestamp).toLocaleTimeString()}</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Health Score</div>
                      <div className="text-3xl font-bold text-emerald-900">{result.healthScore.toFixed(1)}%</div>
                    </div>
                    <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                      <div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Flux Rate</div>
                      <div className="text-3xl font-bold text-indigo-900">{result.fluxRate}</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Metabolic Bottlenecks</h4>
                    {result.bottlenecks.length === 0 ? (
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-500 italic">No bottlenecks detected. System is optimized.</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {result.bottlenecks.map((b, i) => (
                          <span key={i} className="px-3 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-full text-[10px] font-bold uppercase">{b}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-2xl overflow-hidden relative">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-emerald-500" />
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                      <BrainCircuit size={16} /> AI Failure Prediction
                    </h3>
                    {isAnalyzing && <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />}
                  </div>
                  
                  <div className="text-xs text-slate-300 leading-relaxed min-h-[100px]">
                    {isAnalyzing ? (
                      <div className="flex flex-col gap-2">
                        <div className="h-3 w-full bg-slate-800 rounded animate-pulse" />
                        <div className="h-3 w-3/4 bg-slate-800 rounded animate-pulse" />
                        <div className="h-3 w-1/2 bg-slate-800 rounded animate-pulse" />
                      </div>
                    ) : (
                      <div className="prose prose-invert prose-sm">
                        {aiAnalysis || "Awaiting AI synthesis..."}
                      </div>
                    )}
                  </div>
                  
                  {!isAnalyzing && aiAnalysis && (
                    <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-2 text-[10px] text-slate-500 italic">
                      <AlertTriangle size={12} className="text-amber-500" />
                      Predictions are based on current metabolic flux and historical biological models.
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default FullStackSimulation;
