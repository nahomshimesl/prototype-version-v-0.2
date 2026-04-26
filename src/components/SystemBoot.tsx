import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface SystemBootProps {
  onComplete: () => void;
}

interface BootLine {
  id: number;
  text: string;
  status: 'pending' | 'running' | 'ok' | 'warn';
  detail?: string;
}

const BOOT_SEQUENCE: Array<{ text: string; durationMs: number; detail?: string; status?: 'ok' | 'warn' }> = [
  { text: 'POST  ::  power-on self test', durationMs: 280, detail: 'cpu/mem/io nominal' },
  { text: 'KERN  ::  loading process supervisor', durationMs: 240, detail: 'pid 1 ready' },
  { text: 'NET   ::  binding socket.io transport', durationMs: 320, detail: 'ws/4.8.3 :: full-duplex' },
  { text: 'AUTH  ::  initializing firebase identity layer', durationMs: 360, detail: 'oauth2 / google idp' },
  { text: 'CORE  ::  mounting metabolic flux engine', durationMs: 420, detail: 'phi-recursive solver' },
  { text: 'SIM   ::  spawning agent population', durationMs: 380, detail: 'n=50  topology=organoid' },
  { text: 'GPU   ::  initializing parallel compute hub', durationMs: 320, detail: 'webworker pool ready' },
  { text: 'AI    ::  arming gemini predictive analyzer', durationMs: 340, detail: 'fallback=heuristic' },
  { text: 'WATCH ::  stability sentinel  online', durationMs: 280, detail: 'anomaly detection armed' },
  { text: 'TELEM ::  opening telemetry pipeline', durationMs: 240, detail: 'ringbuffer 50 events' },
  { text: 'UI    ::  compositing operator console', durationMs: 260 },
  { text: 'SYS   ::  all subsystems nominal', durationMs: 380, status: 'ok', detail: 'handoff to operator' },
];

const HEX = (n: number) =>
  n.toString(16).toUpperCase().padStart(4, '0');

function useClock(active: boolean) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setT(Date.now()), 250);
    return () => clearInterval(i);
  }, [active]);
  return t;
}

export default function SystemBoot({ onComplete }: SystemBootProps) {
  const [lines, setLines] = useState<BootLine[]>([]);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'boot' | 'handoff' | 'done'>('boot');
  const [serial] = useState(() =>
    Array.from({ length: 4 }, () => HEX(Math.floor(Math.random() * 0xffff))).join('-')
  );
  const startedAt = useRef(Date.now());
  const time = useClock(stage !== 'done');

  const completedRef = useRef(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const activeRef = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setStage('done');
    onComplete();
  }, [onComplete]);

  const skip = useCallback(() => {
    if (completedRef.current) return;
    // cancel everything in flight
    activeRef.current = false;
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    setProgress(100);
    finish();
  }, [finish]);

  useEffect(() => {
    activeRef.current = true;
    let idx = 0;
    const total = BOOT_SEQUENCE.length;

    const schedule = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timersRef.current.delete(id);
        if (!activeRef.current) return;
        fn();
      }, ms);
      timersRef.current.add(id);
      return id;
    };

    const runNext = () => {
      if (!activeRef.current) return;
      if (idx >= total) {
        setProgress(100);
        schedule(() => setStage('handoff'), 220);
        schedule(() => finish(), 900);
        return;
      }
      const step = BOOT_SEQUENCE[idx];
      const id = idx;
      setLines((prev) => {
        if (prev.some((l) => l.id === id)) return prev;
        return [...prev, { id, text: step.text, status: 'running', detail: step.detail }];
      });
      schedule(() => {
        setLines((prev) =>
          prev.map((l) => (l.id === id ? { ...l, status: step.status ?? 'ok' } : l))
        );
        idx++;
        setProgress(Math.round((idx / total) * 100));
        runNext();
      }, step.durationMs);
    };

    runNext();

    return () => {
      activeRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    };
  }, [finish]);

  // Focus the dialog so keyboard shortcuts work without clicking first
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      skip();
    }
  };

  const elapsed = ((time - startedAt.current) / 1000).toFixed(2);

  return (
    <AnimatePresence>
      {stage !== 'done' && (
        <motion.div
          key="boot"
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-label="System boot sequence"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
          className="fixed inset-0 z-[9999] bg-black text-emerald-300 font-mono overflow-hidden select-none focus:outline-none"
          style={{
            backgroundImage:
              'radial-gradient(ellipse at center, rgba(16,185,129,0.10) 0%, rgba(0,0,0,0.95) 70%)',
          }}
        >
          {/* Live region for assistive tech */}
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="false">
            {lines.length > 0 &&
              `${lines[lines.length - 1].text}${
                lines[lines.length - 1].status === 'ok' ? ' — ok' : ''
              }`}
            {stage === 'handoff' && ' — handoff to operator'}
          </div>

          {/* Scanlines */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-screen"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 3px)',
            }}
          />
          {/* Vignette flicker */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            animate={{ opacity: [0.35, 0.55, 0.4, 0.5, 0.35] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.85) 100%)',
            }}
          />

          {/* Corner brackets */}
          {[
            'top-4 left-4 border-l-2 border-t-2',
            'top-4 right-4 border-r-2 border-t-2',
            'bottom-4 left-4 border-l-2 border-b-2',
            'bottom-4 right-4 border-r-2 border-b-2',
          ].map((cls, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={`absolute w-10 h-10 border-emerald-500/60 ${cls}`}
            />
          ))}

          <div className="relative h-full w-full flex flex-col px-8 pt-8 pb-6">
            {/* Header */}
            <div className="flex items-start justify-between text-[11px] tracking-widest text-emerald-400/80 uppercase">
              <div className="space-y-1">
                <div>BOSS // Bio-Organoid Simulation System</div>
                <div className="text-emerald-500/50">
                  Build 12.4.1 · firmware r2026.04 · classification: research
                </div>
              </div>
              <div className="text-right space-y-1">
                <div>NODE {serial}</div>
                <div className="text-emerald-500/50">
                  T+{elapsed}s · UTC {new Date(time).toISOString().slice(11, 19)}
                </div>
              </div>
            </div>

            {/* Center display */}
            <div className="flex-1 flex items-center justify-center">
              <div className="w-full max-w-3xl">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="text-center mb-6"
                >
                  <div className="inline-flex items-center gap-3 mb-3">
                    <Reactor />
                    <div className="text-emerald-300 text-[10px] tracking-[0.4em] uppercase">
                      System Cold Start
                    </div>
                    <Reactor />
                  </div>
                  <div className="text-emerald-200 font-bold tracking-[0.25em] text-3xl md:text-5xl">
                    BOSS
                  </div>
                  <div className="text-emerald-400/70 text-xs tracking-[0.35em] uppercase mt-2">
                    Operator Console · v12.4
                  </div>
                </motion.div>

                {/* Boot log */}
                <div className="border border-emerald-500/30 bg-black/60 backdrop-blur-sm">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-emerald-500/30 text-[10px] uppercase tracking-widest text-emerald-400/70">
                    <span>boot.log</span>
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                      live
                    </span>
                  </div>
                  <div className="p-3 h-[260px] overflow-hidden text-[12px] leading-[1.45]">
                    {lines.map((l) => (
                      <motion.div
                        key={l.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.18 }}
                        className="flex items-start gap-3"
                      >
                        <span className="text-emerald-500/40 w-12 shrink-0">
                          [{HEX(l.id * 73 + 0x1000)}]
                        </span>
                        <span className="text-emerald-200 flex-1">
                          {l.text}
                          {l.detail && (
                            <span className="text-emerald-500/50">  ·  {l.detail}</span>
                          )}
                        </span>
                        <StatusTag status={l.status} />
                      </motion.div>
                    ))}
                    {lines.length < BOOT_SEQUENCE.length && (
                      <div className="mt-1 text-emerald-400/60" aria-hidden="true">
                        <span className="animate-pulse">▌</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress + handoff */}
                <div className="mt-5">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-emerald-400/70 mb-1.5">
                    <span>
                      {stage === 'handoff'
                        ? 'handoff to operator'
                        : 'subsystem initialization'}
                    </span>
                    <span>{progress.toString().padStart(3, '0')}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    aria-label="Boot progress"
                    className="relative h-2 border border-emerald-500/30 bg-emerald-950/40 overflow-hidden"
                  >
                    <motion.div
                      className="h-full bg-emerald-400"
                      style={{ boxShadow: '0 0 8px rgba(16,185,129,0.7)' }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 pointer-events-none opacity-50"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(90deg, rgba(0,0,0,0.55) 0 6px, transparent 6px 12px)',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-end justify-between text-[10px] uppercase tracking-widest text-emerald-500/60">
              <div className="flex gap-4" aria-hidden="true">
                <Indicator label="link" ok />
                <Indicator label="hv" ok />
                <Indicator label="cooling" ok />
                <Indicator label="ai" ok />
                <Indicator label="firewall" ok />
              </div>
              <button
                type="button"
                onClick={skip}
                className="px-2 py-1 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 transition-colors uppercase tracking-widest"
              >
                skip · enter
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatusTag({ status }: { status: BootLine['status'] }) {
  const map = {
    pending: { label: 'WAIT', cls: 'text-emerald-500/40 border-emerald-500/30' },
    running: { label: '....', cls: 'text-amber-300 border-amber-500/40 animate-pulse' },
    ok:      { label: ' OK ', cls: 'text-emerald-300 border-emerald-400/60' },
    warn:    { label: 'WARN', cls: 'text-amber-300 border-amber-400/60' },
  } as const;
  const v = map[status];
  return (
    <span className={`shrink-0 px-1.5 text-[10px] tracking-widest border ${v.cls}`}>
      {v.label}
    </span>
  );
}

function Indicator({ label, ok, warn }: { label: string; ok?: boolean; warn?: boolean }) {
  const color = warn ? 'bg-amber-400' : ok ? 'bg-emerald-400' : 'bg-emerald-700';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Reactor() {
  return (
    <motion.div
      aria-hidden="true"
      className="relative w-7 h-7"
      animate={{ rotate: 360 }}
      transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
    >
      <div className="absolute inset-0 border border-emerald-400/70 rounded-full" />
      <div className="absolute inset-1 border border-emerald-400/40 rounded-full" />
      <div className="absolute inset-2.5 bg-emerald-400/80 rounded-full" style={{ boxShadow: '0 0 10px rgba(16,185,129,0.9)' }} />
      <div
        className="absolute inset-0"
        style={{
          background:
            'conic-gradient(from 0deg, rgba(16,185,129,0.6) 0deg, transparent 90deg, rgba(16,185,129,0.6) 180deg, transparent 270deg)',
          mixBlendMode: 'screen',
          borderRadius: '9999px',
        }}
      />
    </motion.div>
  );
}
