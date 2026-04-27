import type { ReactNode } from 'react';
import { motion } from 'motion/react';

export type ActiveTab =
  | 'SIMULATION'
  | 'GENETICS'
  | 'HEALTH'
  | 'POPULATION'
  | 'FULLSTACK'
  | 'TELEMETRY'
  | 'ANALYSIS'
  | 'SENTINEL'
  | 'HISTORY'
  | 'ABOUT';
import {
  Microscope,
  BrainCircuit,
  Dna,
  ShieldAlert,
  Activity,
  FlaskConical,
  Network,
  Binary,
  Brain,
  AlertTriangle,
  Workflow,
  BookOpen,
  GitBranch,
  Cpu,
  Database,
  ArrowRight,
  Sparkles,
  Layers,
} from 'lucide-react';

interface AboutPanelProps {
  onJump?: (tab: ActiveTab) => void;
}

export default function AboutPanel({ onJump }: AboutPanelProps) {
  return (
    <div className="h-full overflow-y-auto bg-emerald-950 text-emerald-50">
      <div className="max-w-6xl mx-auto px-8 py-10 space-y-10">

        {/* HERO */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative border border-emerald-800/70 bg-gradient-to-br from-emerald-900/60 to-emerald-950 rounded-2xl p-8 overflow-hidden"
        >
          <div
            aria-hidden
            className="absolute -right-20 -top-20 w-80 h-80 rounded-full opacity-20"
            style={{
              background:
                'radial-gradient(closest-side, rgba(16,185,129,0.6), transparent 70%)',
            }}
          />
          <div className="relative">
            <div className="flex items-center gap-3 text-emerald-400 text-[11px] uppercase tracking-[0.32em] font-bold">
              <Microscope size={14} /> About this software
            </div>
            <h1
              className="mt-3 text-4xl md:text-5xl font-bold tracking-tight text-emerald-50"
              style={{ fontFamily: "'Iowan Old Style','Palatino Linotype','Georgia',serif" }}
            >
              Bio-Organoid Simulation System
            </h1>
            <p className="mt-2 text-emerald-300 text-lg max-w-3xl leading-relaxed">
              A research workbench for modeling synthetic biological tissues —{' '}
              <span className="text-emerald-200 font-semibold">
                edit a single genetic parameter and watch the AI predict whether the whole organoid is heading for failure.
              </span>
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-widest font-mono">
              <Pill>BOSS v12.4.1</Pill>
              <Pill>Apache-2.0</Pill>
              <Pill>Φ-recursive solver</Pill>
              <Pill warn>Gemini AI · fallback heuristic</Pill>
            </div>
            <div className="mt-5 text-emerald-400/90 text-sm italic">
              Project lead:{' '}
              <span className="text-amber-200 not-italic font-semibold">
                Nahom Berhanu
              </span>{' '}
              · Rockville High School
            </div>
          </div>
        </motion.section>

        {/* WHAT IT DOES */}
        <Section
          eyebrow="What this app does"
          title="A live simulation of an organoid you can edit, perturb, and stress-test."
        >
          <p className="text-emerald-300 text-base leading-relaxed max-w-4xl">
            BOSS spawns a population of cell-like agents that exchange biochemical signals
            on a Φ-recursive (golden-ratio scaled) topology. You can <strong className="text-emerald-200">edit
            their DNA, mutate individuals, inject stressors, or trigger faults</strong> — and the
            system tells you, in real time, where the organoid is likely to break down.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <FeatureCard
              icon={<Activity className="text-emerald-300" size={22} />}
              title="Living simulation"
              body="Hundreds of cell-agents exchange metabolic signals every animation frame, producing emergent population dynamics."
            />
            <FeatureCard
              icon={<Dna className="text-emerald-300" size={22} />}
              title="Editable genetics"
              body="Tune metabolism, decay, signaling thresholds, and Φ-scaling. Every change immediately propagates through the population."
            />
            <FeatureCard
              icon={<BrainCircuit className="text-emerald-300" size={22} />}
              title="AI failure prediction"
              body="A Gemini-backed analyzer ranks the likelihood that your edit pushes the system toward collapse, with a heuristic fallback."
              highlight
            />
            <FeatureCard
              icon={<ShieldAlert className="text-emerald-300" size={22} />}
              title="Stability Sentinel"
              body="A separate runtime watchdog detects anomalies (memory spikes, error storms, recurring faults) and proposes recovery actions."
            />
          </div>
        </Section>

        {/* FAILURE PREDICTION WORKFLOW — the key feature */}
        <Section
          eyebrow="Headline capability"
          title="Predicting biological failure when you edit a part."
          accent
        >
          <p className="text-emerald-300 text-base leading-relaxed max-w-4xl">
            Most simulators just <em>show</em> you what happens after a change. BOSS does
            something more useful for research: it tries to <strong className="text-emerald-200">tell you
            in advance whether your edit will cause the organoid to fail</strong>, why,
            and what to do about it. Here's the loop:
          </p>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3">
            <Step
              n={1}
              icon={<Dna size={18} />}
              title="You edit a part"
              body="Change a DNA parameter or a single agent's metabolism in the Genetic Manager."
            />
            <Step
              n={2}
              icon={<Cpu size={18} />}
              title="Engine propagates"
              body="The Φ-recursive solver re-integrates the population and emits new metabolic & telemetry signals."
            />
            <Step
              n={3}
              icon={<BrainCircuit size={18} />}
              title="AI predicts collapse"
              body="Current state is fed to Gemini, which returns a ranked failure forecast — what will break, when, and how confident it is."
              highlight
            />
            <Step
              n={4}
              icon={<Sparkles size={18} />}
              title="Mutation suggested"
              body="If a critical agent is detected, the AI proposes a counter-mutation. You approve, reject, or ignore it."
            />
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <PredictionExample
              before="Lower decayRate to 0.005"
              prob="84%"
              outcome="Cascading hyperactivity"
              detail="Signal density saturates within ~120 steps; population becomes unable to dissipate energy."
            />
            <PredictionExample
              before="Drop signalThreshold to 0.05"
              prob="61%"
              outcome="False-positive storm"
              detail="Agents fire on noise; entropy spikes; Sentinel will likely raise an anomaly within 50 steps."
            />
            <PredictionExample
              before="Triple metabolismRate"
              prob="92%"
              outcome="Energy depletion failure"
              detail="Average health falls below 30 within 80 steps; recommend rolling back DNA or reducing population."
            />
          </div>

          <div className="mt-6 border border-emerald-800/70 bg-emerald-900/30 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-amber-300 shrink-0 mt-0.5" size={18} />
              <div className="text-sm text-emerald-200 leading-relaxed">
                <strong className="text-amber-200">Why this matters for biology research:</strong>{' '}
                in real wet-lab organoid work you can't easily un-edit a CRISPR
                modification. A predictive model that flags "this edit is 84% likely
                to cause collapse" lets you screen <em>in silico</em> before committing
                to expensive experiments.
              </div>
            </div>
          </div>
        </Section>

        {/* ARCHITECTURE */}
        <Section
          eyebrow="Architecture"
          title="A full-stack research instrument, not a toy."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="space-y-3">
              <Pillar
                icon={<Layers size={18} />}
                title="Frontend"
                body="React 19 + Vite 6 + Tailwind v4. The visualizer runs on Canvas with a dedicated WebWorker for the simulation step, so the UI never blocks while the engine integrates."
              />
              <Pillar
                icon={<Network size={18} />}
                title="Realtime backend"
                body="Express + Socket.IO server bundled with esbuild. Pushes telemetry, anomalies, and AI events to all connected operator consoles."
              />
              <Pillar
                icon={<BrainCircuit size={18} />}
                title="AI layer"
                body="Google Gemini for predictions, mutation suggestions, and root-cause analysis of incidents. If the API key is absent, the system gracefully degrades to deterministic heuristics."
              />
              <Pillar
                icon={<Database size={18} />}
                title="Persistence"
                body="Firebase Auth (Google IdP) + Firestore for research-log snapshots. Every save records the metrics, timestamp, and operator identity."
              />
            </div>

            <ArchitectureDiagram />
          </div>
        </Section>

        {/* MODULE GUIDE */}
        <Section
          eyebrow="Module guide"
          title="Every tab, what it's for, and when to open it."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Module icon={<Network size={16} />}    name="Simulation"        body="Live 2D view of the organoid. Watch agents move, signal, and decay in real time." onClick={() => onJump?.('SIMULATION')} />
            <Module icon={<Microscope size={16} />} name="Population"        body="Tabular roster with grouping by type or health. Filter who shows up in the visualizer." onClick={() => onJump?.('POPULATION')} />
            <Module icon={<Brain size={16} />}      name="Statistical Analysis" body="Distribution plots, entropy, signal density. The right tab for cohort-level inferences." onClick={() => onJump?.('ANALYSIS')} />
            <Module icon={<Dna size={16} />}        name="Genetic Manager"   body="Edit the population's DNA. This is where you trigger the failure-prediction loop." onClick={() => onJump?.('GENETICS')} />
            <Module icon={<Binary size={16} />}     name="Compute Telemetry" body="Throughput, frame budget, parallelism. Useful when tuning simulation speed." onClick={() => onJump?.('TELEMETRY')} />
            <Module icon={<ShieldAlert size={16} />} name="Health Engine"    body="Domain health: incidents from inside the simulation (e.g. agent collapse, runaway signals)." onClick={() => onJump?.('HEALTH')} />
            <Module icon={<ShieldAlert size={16} />} name="Stability Sentinel" body="Runtime health: AI-diagnosed anomalies, error fingerprints, approval-gated recovery." onClick={() => onJump?.('SENTINEL')} />
            <Module icon={<FlaskConical size={16} />} name="Full-Stack Prototype" body="Sandbox showing the realtime collaboration layer between multiple operator consoles." onClick={() => onJump?.('FULLSTACK')} />
          </div>
        </Section>

        {/* QUICK START */}
        <Section
          eyebrow="Quick start"
          title="Try the failure-prediction loop in 30 seconds."
        >
          <ol className="space-y-3">
            <Howto n="1" body={<>Open the <em>Genetic Manager</em> tab.</>} action={onJump ? () => onJump('GENETICS') : undefined} actionLabel="Go" />
            <Howto n="2" body={<>Lower <code className="px-1 bg-emerald-900 rounded text-amber-200">decayRate</code> from 0.02 → 0.005.</>} />
            <Howto n="3" body={<>Switch to <em>Simulation</em>, press <kbd className="px-1.5 py-0.5 bg-emerald-900 border border-emerald-700 rounded text-[10px]">PLAY</kbd>, and let it run for ~10 seconds.</>} action={onJump ? () => onJump('SIMULATION') : undefined} actionLabel="Open" />
            <Howto n="4" body={<>Click <em>Analyze</em> in the right Control Panel to request a Gemini prediction.</>} />
            <Howto n="5" body={<>If a critical agent is auto-detected, the AI will propose a counter-mutation — approve or reject it.</>} />
            <Howto n="6" body={<>Watch the <em>Stability Sentinel</em> tab for any runtime anomalies it flags.</>} action={onJump ? () => onJump('SENTINEL') : undefined} actionLabel="Watch" />
          </ol>
        </Section>

        {/* CITATION + CREDITS */}
        <Section
          eyebrow="Citation"
          title="Using BOSS in academic work?"
        >
          <div className="border border-emerald-800/70 bg-emerald-950/70 rounded-xl p-5">
            <div className="text-[11px] uppercase tracking-widest text-emerald-400 mb-2 font-mono">
              <BookOpen size={12} className="inline mr-1.5 -mt-0.5" /> Suggested citation
            </div>
            <p
              className="text-emerald-100 leading-relaxed"
              style={{ fontFamily: "'Iowan Old Style','Palatino Linotype','Georgia',serif" }}
            >
              Berhanu, N. (2026).{' '}
              <em>
                Bio-Organoid Simulation System: a Φ-recursive framework for
                predicting cascading failure in synthetic organoids.
              </em>{' '}
              <span className="text-emerald-400">Rockville High School. v12.4.1.</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-mono">
              <Pill><GitBranch size={11} className="inline mr-1" /> Apache-2.0</Pill>
              <Pill><Workflow size={11} className="inline mr-1" /> Reproducible (RNG seeded)</Pill>
              <Pill warn><AlertTriangle size={11} className="inline mr-1" /> Research-only · not for clinical decisions</Pill>
            </div>
          </div>
        </Section>

      </div>
    </div>
  );
}

/* ------------------------------ Helpers ------------------------------ */

function Section({
  eyebrow,
  title,
  accent,
  children,
}: {
  eyebrow: string;
  title: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.45 }}
      className={`${accent ? 'border border-amber-300/30 bg-amber-300/[0.02] rounded-2xl p-6' : ''}`}
    >
      <div className={`text-[11px] uppercase tracking-[0.3em] font-bold ${accent ? 'text-amber-300' : 'text-emerald-400'}`}>
        {eyebrow}
      </div>
      <h2
        className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-emerald-50"
        style={{ fontFamily: "'Iowan Old Style','Palatino Linotype','Georgia',serif" }}
      >
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

function Pill({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <span
      className={`px-2.5 py-1 rounded-full border ${
        warn
          ? 'border-amber-400/40 text-amber-200 bg-amber-300/10'
          : 'border-emerald-700 text-emerald-300 bg-emerald-900/40'
      }`}
    >
      {children}
    </span>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  highlight,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-5 rounded-xl border ${
        highlight
          ? 'border-amber-400/40 bg-gradient-to-br from-amber-300/[0.06] to-transparent'
          : 'border-emerald-800/70 bg-emerald-900/30'
      }`}
    >
      <div className="flex items-center gap-2.5 mb-2">
        {icon}
        <h3 className="text-base font-bold text-emerald-50">{title}</h3>
        {highlight && (
          <span className="ml-auto text-[10px] font-mono uppercase tracking-widest text-amber-300 border border-amber-400/40 px-1.5 py-0.5 rounded">
            flagship
          </span>
        )}
      </div>
      <p className="text-sm text-emerald-300 leading-relaxed">{body}</p>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
  highlight,
}: {
  n: number;
  icon: ReactNode;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`relative p-4 rounded-xl border ${
        highlight
          ? 'border-amber-400/50 bg-amber-300/[0.05]'
          : 'border-emerald-800/70 bg-emerald-900/30'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-mono font-bold ${
            highlight ? 'bg-amber-300 text-emerald-950' : 'bg-emerald-700 text-emerald-50'
          }`}
        >
          {n}
        </span>
        <span className="text-emerald-300">{icon}</span>
        <h4 className="text-sm font-bold text-emerald-50">{title}</h4>
      </div>
      <p className="text-xs text-emerald-300 leading-relaxed">{body}</p>
    </div>
  );
}

function PredictionExample({
  before,
  prob,
  outcome,
  detail,
}: {
  before: string;
  prob: string;
  outcome: string;
  detail: string;
}) {
  return (
    <div className="border border-emerald-800/70 bg-emerald-950/70 rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-mono mb-1">
        Edit
      </div>
      <div className="text-sm text-emerald-100 font-mono">{before}</div>

      <div className="my-3 flex items-center gap-2 text-emerald-500/60 text-xs">
        <ArrowRight size={14} /> AI prediction
      </div>

      <div className="flex items-baseline justify-between">
        <div className="text-xs text-emerald-400 uppercase tracking-widest font-mono">
          {outcome}
        </div>
        <div className="text-xl font-bold text-amber-300 font-mono">{prob}</div>
      </div>
      <p className="mt-2 text-xs text-emerald-300/90 leading-relaxed">{detail}</p>
    </div>
  );
}

function Pillar({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="border border-emerald-800/70 bg-emerald-900/30 rounded-xl p-4">
      <div className="flex items-center gap-2 text-emerald-300 mb-1.5">
        {icon}
        <h4 className="text-sm font-bold text-emerald-50">{title}</h4>
      </div>
      <p className="text-sm text-emerald-300 leading-relaxed">{body}</p>
    </div>
  );
}

function Module({
  icon,
  name,
  body,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  body: string;
  onClick?: () => void;
}) {
  const Wrap: any = onClick ? 'button' : 'div';
  return (
    <Wrap
      onClick={onClick}
      className={`group text-left p-4 rounded-xl border border-emerald-800/70 bg-emerald-900/30 transition-all ${
        onClick ? 'hover:border-emerald-500/60 hover:bg-emerald-900/60 cursor-pointer' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-emerald-300">
          {icon}
          <h4 className="text-sm font-bold text-emerald-50">{name}</h4>
        </div>
        {onClick && (
          <ArrowRight
            size={14}
            className="text-emerald-500/60 group-hover:text-emerald-300 transition-colors"
          />
        )}
      </div>
      <p className="text-xs text-emerald-300 leading-relaxed">{body}</p>
    </Wrap>
  );
}

function Howto({
  n,
  body,
  action,
  actionLabel,
}: {
  n: string;
  body: ReactNode;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <li className="flex items-start gap-3 p-3 border border-emerald-800/70 bg-emerald-900/20 rounded-lg">
      <span className="w-6 h-6 rounded-full bg-emerald-700 text-emerald-50 grid place-items-center text-[11px] font-mono font-bold shrink-0">
        {n}
      </span>
      <div className="flex-1 text-sm text-emerald-200 leading-relaxed">{body}</div>
      {action && (
        <button
          onClick={action}
          className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border border-emerald-600 text-emerald-300 rounded hover:bg-emerald-800/60 hover:border-emerald-400 transition-colors"
        >
          {actionLabel ?? 'Open'} <ArrowRight size={11} className="inline -mt-0.5" />
        </button>
      )}
    </li>
  );
}

function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 360 280"
      className="w-full h-auto border border-emerald-800/70 rounded-xl bg-emerald-950/60 p-2"
      role="img"
      aria-label="Architecture diagram"
    >
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 Z" fill="#34d399" />
        </marker>
      </defs>

      <Box x={20} y={30} w={120} h={50} title="React UI" sub="Visualizer · Tabs" />
      <Box x={220} y={30} w={120} h={50} title="WebWorker" sub="SimulationLoop" />

      <Box x={20} y={120} w={120} h={50} title="Express + Socket.IO" sub="server.ts" />
      <Box x={220} y={120} w={120} h={50} title="Gemini AI" sub="Predict · Mutate · Diagnose" highlight />

      <Box x={20} y={210} w={120} h={50} title="Firestore" sub="Research logs" />
      <Box x={220} y={210} w={120} h={50} title="Stability Sentinel" sub="Anomaly detection" />

      {/* arrows */}
      <Arrow x1={140} y1={55} x2={220} y2={55} />
      <Arrow x1={80}  y1={80} x2={80}  y2={120} />
      <Arrow x1={280} y1={80} x2={280} y2={120} />
      <Arrow x1={140} y1={145} x2={220} y2={145} />
      <Arrow x1={80}  y1={170} x2={80}  y2={210} />
      <Arrow x1={280} y1={170} x2={280} y2={210} />
      <Arrow x1={140} y1={235} x2={220} y2={235} />
    </svg>
  );
}

function Box({
  x, y, w, h, title, sub, highlight,
}: {
  x: number; y: number; w: number; h: number; title: string; sub: string; highlight?: boolean;
}) {
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h} rx={6}
        fill={highlight ? '#451a03' : '#064e3b'}
        stroke={highlight ? '#fbbf24' : '#10b981'}
        strokeOpacity={highlight ? 0.8 : 0.5}
        strokeWidth={1.2}
      />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" fontSize="11" fontWeight="bold" fill={highlight ? '#fcd34d' : '#a7f3d0'}>
        {title}
      </text>
      <text x={x + w / 2} y={y + 38} textAnchor="middle" fontSize="9" fill={highlight ? '#fde68a' : '#6ee7b7'} opacity={0.85}>
        {sub}
      </text>
    </g>
  );
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke="#34d399" strokeOpacity="0.6" strokeWidth="1.2"
      markerEnd="url(#arr)"
    />
  );
}
