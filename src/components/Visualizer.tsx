/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { AgentState, BioSignal, OrganType } from '../types/simulation';
import { Activity, X } from 'lucide-react';

interface VisualizerProps {
  agents: AgentState[];
  signals: BioSignal[];
  width: number;
  height: number;
}

const Visualizer: React.FC<VisualizerProps> = ({ agents, signals, width, height }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const tracedSignalIds = useMemo(() => {
    if (!selectedSignalId) return new Set<string>();
    const ids = new Set<string>();
    let currentId: string | undefined = selectedSignalId;
    
    // Trace backwards to find the root
    while (currentId) {
      ids.add(currentId);
      const currentSignal = signals.find(s => s.id === currentId);
      currentId = currentSignal?.parentId;
    }
    
    // Also trace forwards to find all descendants of the selected signal
    const findDescendants = (parentId: string) => {
      signals.forEach(s => {
        if (s.parentId === parentId && !ids.has(s.id)) {
          ids.add(s.id);
          findDescendants(s.id);
        }
      });
    };
    findDescendants(selectedSignalId);
    
    return ids;
  }, [selectedSignalId, signals]);

  const tracedAgentIds = useMemo(() => {
    const ids = new Set<string>();
    tracedSignalIds.forEach(sigId => {
      const sig = signals.find(s => s.id === sigId);
      if (sig) {
        ids.add(sig.source);
        ids.add(sig.target);
      }
    });
    return ids;
  }, [tracedSignalIds, signals]);

  const selectedAgent = useMemo(() => 
    agents.find(a => a.id === selectedAgentId),
  [agents, selectedAgentId]);

  // Keep persistent simulation and references
  const simulationRef = useRef<d3.Simulation<any, any> | null>(null);
  const activeLinksRef = useRef<Map<string, any>>(new Map());
  const activeNodesRef = useRef<Map<string, any>>(new Map());
  const physicsArraysRef = useRef<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
  const elementsRef = useRef<{
    g: d3.Selection<SVGGElement, unknown, null, undefined>;
    linkLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
    particleLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
    nodeLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
  } | null>(null);

  // 1. Initial Setup ONLY
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear only on mount

    const g = svg.append('g');
    const linkLayer = g.append('g');
    const particleLayer = g.append('g');
    const nodeLayer = g.append('g');

    elementsRef.current = { g, linkLayer, particleLayer, nodeLayer };

    // Add filters
    const defs = svg.append('defs');
    const filter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    
    filter.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'blur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Setup Simulation (runs continuously as alpha decays, then stops naturally)
    const simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [width, height]); // Re-run only if canvas heavily resizes

  // 2. Data Update Loop (Runs on state change)
  useEffect(() => {
    if (!simulationRef.current || !elementsRef.current) return;
    const { linkLayer, particleLayer, nodeLayer } = elementsRef.current;
    const simulation = simulationRef.current;

    // Use a stable reference of nodes so dragging (fx, fy) and physics (x, y) persist
    const activeNodesMap = activeNodesRef.current;
    let topologyChanged = false;
    
    // Cull dead agents
    const incomingIds = new Set(agents.map(a => a.id));
    for (const key of activeNodesMap.keys()) {
      if (!incomingIds.has(key)) {
        activeNodesMap.delete(key);
        topologyChanged = true;
      }
    }

    // Upsert or update existing agents with new simulation data (health, energy, etc)
    agents.forEach(a => {
      if (!activeNodesMap.has(a.id)) {
        activeNodesMap.set(a.id, { ...a }); // Clone initial D3 object
        topologyChanged = true;
      } else {
        const existing = activeNodesMap.get(a.id);
        // Keep D3 physics fields unchanged, only overwrite simulation state
        Object.assign(existing, a, {
          x: existing.x, y: existing.y, 
          fx: existing.fx, fy: existing.fy, 
          vx: existing.vx, vy: existing.vy 
        });
      }
    });

    const physicsNodes = Array.from(activeNodesMap.values());

    // Use a trailing visual buffer to keep signals visible for a bit
    // because the backend simulation loop culls signals instantly
    const activeLinksMap = activeLinksRef.current;
    
    // 1. Age and Cull old visual links
    for (const [id, link] of activeLinksMap.entries()) {
      link.age = (link.age || 0) + 1;
      if (link.age > 40) {
        activeLinksMap.delete(id);
        topologyChanged = true;
      }
    }

    // 2. Add new signal links
    signals.forEach(s => {
      if (!activeLinksMap.has(s.id)) {
        // Clone so D3 physics can inject object refs safely
        activeLinksMap.set(s.id, { ...s, age: 0 });
        topologyChanged = true;
      }
    });

    const linksData = Array.from(activeLinksMap.values());

    if (topologyChanged) {
      physicsArraysRef.current.nodes = physicsNodes;
      physicsArraysRef.current.links = linksData;
      // Apply data to physics engine WITHOUT restarting alpha artificially each frame, only when topology changes
      simulation.nodes(physicsArraysRef.current.nodes as any);
      (simulation.force('link') as any).links(physicsArraysRef.current.links);
      
      // Give a tiny nudge to adjust to new strings/nodes
      if (simulation.alpha() < 0.05) simulation.alpha(0.05).restart();
    }

    // Ensure we only keep valid links where source/target were correctly matched
    const validLinksData = physicsArraysRef.current.links.filter(d => typeof d.source === 'object' && typeof d.target === 'object');
    
    // Draw Links
    const linkSelection = linkLayer.selectAll<SVGLineElement, any>('line')
      .data(validLinksData, d => d.id)
      .join('line')
      .attr('stroke', (d: any) => {
        if (d.type === 'ATP') return '#10b981';
        if (d.type === 'HORMONAL') return '#34d399';
        if (d.type === 'CYTOKINE') return '#ef4444';
        if (d.type === 'ALERT') return '#f43f5e';
        return '#059669';
      })
      .attr('stroke-width', (d: any) => {
        const baseWidth = Math.max(2, Math.sqrt(d.payload) * (d.isUrgent ? 2 : 1.5));
        return tracedSignalIds.has(d.id) ? baseWidth * 2 : baseWidth;
      })
      .attr('stroke-opacity', (d: any) => {
        if (selectedSignalId && !tracedSignalIds.has(d.id)) return 0.1;
        return d.isUrgent ? 0.8 : 0.5;
      })
      .attr('stroke-dasharray', (d: any) => {
        if (tracedSignalIds.has(d.id) || d.type === 'ALERT') return '5,5';
        return 'none';
      })
      .attr('cursor', 'pointer')
      .on('click', (event, d: any) => {
        event.stopPropagation();
        setSelectedSignalId(d.id);
      });

    // Draw Particles
    const particleData = linksData.flatMap((d: any) => [
      { ...(d as object), offset: 0, size: 1, opacity: 0.8 },
      { ...(d as object), offset: 0.05, size: 0.7, opacity: 0.4 },
      { ...(d as object), offset: 0.1, size: 0.4, opacity: 0.2 }
    ]);

    const particleSelection = particleLayer.selectAll<SVGCircleElement, any>('circle')
      .data(particleData, d => `${d.id}-${d.offset}`)
      .join('circle')
      .attr('class', (d: any) => `signal-particle ${d.isUrgent ? 'animate-pulse' : ''}`)
      .attr('r', (d: any) => Math.max(2, (Math.sqrt(d.payload) * 2.5) * d.size))
      .attr('fill', (d: any) => {
        if (d.type === 'ATP') return '#10b981';
        if (d.type === 'HORMONAL') return '#34d399';
        if (d.type === 'CYTOKINE') return '#ef4444';
        if (d.type === 'ALERT') return '#f43f5e';
        return '#059669';
      })
      .attr('fill-opacity', (d: any) => (selectedSignalId && !tracedSignalIds.has(d.id)) ? 0.02 : d.opacity)
      .attr('filter', (d: any) => d.isUrgent ? 'url(#glow)' : 'none');

    // Draw Nodes
    const activeSourceAgentIds = new Set(signals.map(s => s.source));
    const activeTargetAgentIds = new Set(signals.map(s => s.target));

    const nodeSelection = nodeLayer.selectAll<SVGGElement, any>('g.agent-group')
      .data(physicsNodes, d => d.id)
      .join(
        enter => {
          const gGroup = enter.append('g')
            .attr('class', 'agent-group')
            .attr('cursor', 'pointer')
            .call(d3.drag<any, any>()
              .on('start', dragstarted)
              .on('drag', dragged)
              .on('end', dragended)
            );
          
          gGroup.append('circle').attr('class', 'radius-indicator');
          gGroup.append('circle').attr('class', 'ripple-indicator');
          gGroup.append('circle').attr('class', 'main-body');
          gGroup.append('text').attr('class', 'label-text')
            .attr('font-size', '10px')
            .attr('dx', 18)
            .attr('dy', 4)
            .attr('fill', '#064e3b')
            .attr('font-weight', 'bold');

          return gGroup;
        },
        update => update,
        exit => exit.remove()
      )
      .on('click', (event, d: any) => {
        event.stopPropagation();
        setSelectedAgentId(d.id);
        setSelectedSignalId(null);
      });

    // Update internal elements of nodes seamlessly
    nodeSelection.select('.radius-indicator')
      .attr('r', (d: any) => d.interactionRadius || 100)
      .attr('fill', (d: any) => d.id === selectedAgentId ? '#fbbf24' : (d.health < 30 ? '#f43f5e' : '#10b981'))
      .attr('fill-opacity', (d: any) => d.id === selectedAgentId ? 0.1 : 0.03)
      .attr('stroke', (d: any) => d.id === selectedAgentId ? '#fbbf24' : (d.health < 30 ? '#f43f5e' : '#10b981'))
      .attr('stroke-opacity', (d: any) => d.id === selectedAgentId ? 0.6 : 0.1)
      .attr('stroke-dasharray', '2,2')
      .style('filter', (d: any) => d.id === selectedAgentId ? 'url(#glow)' : 'none');

    nodeSelection.select('.ripple-indicator')
      .attr('fill', 'transparent')
      .attr('stroke', (d: any) => {
        if (activeSourceAgentIds.has(d.id)) return '#34d399';
        if (activeTargetAgentIds.has(d.id)) return '#60a5fa';
        return 'transparent';
      })
      .attr('stroke-width', (d: any) => (activeSourceAgentIds.has(d.id) || activeTargetAgentIds.has(d.id)) ? 2 : 0)
      .style('filter', 'url(#glow)');

    nodeSelection.select('.main-body')
      .attr('r', (d: any) => {
        const baseSize = 12 + (d.energy / 10);
        return d.id === selectedAgentId ? baseSize * 1.5 : baseSize;
      })
      .attr('fill', (d: any) => {
        if (selectedSignalId && !tracedAgentIds.has(d.id)) return '#1e293b';
        if (d.type === OrganType.METABOLIC_HUB) return '#059669';
        if (d.type === OrganType.SIGNAL_TRANSDUCER) return '#10b981';
        if (d.type === OrganType.RESOURCE_COLLECTOR) return '#34d399';
        if (d.type === OrganType.STRUCTURAL_ANCHOR) return '#064e3b';
        if (d.type === OrganType.IMMUNE_SENTINEL) return '#dc2626';
        return '#065f46';
      })
      .attr('stroke', (d: any) => {
        if (d.id === selectedAgentId) return '#fbbf24';
        return tracedAgentIds.has(d.id) ? '#fbbf24' : '#ecfdf5';
      })
      .attr('stroke-width', (d: any) => (d.id === selectedAgentId || tracedAgentIds.has(d.id)) ? 4 : 2)
      .attr('class', 'drop-shadow-lg main-body')
      .style('filter', (d: any) => d.id === selectedAgentId ? 'url(#glow)' : 'none');

    nodeSelection.select('.label-text')
      .text((d: any) => d.name.split('-')[0]);

    // Attach simulation tick handler ONCE, overriding older ones
    simulation.on('tick.render', () => {
      const now = performance.now();
      const time = now / 1500;
      const rippleT = (now % 1200) / 1200;

      linkSelection
        .attr('x1', (d: any) => d.source.x || 0)
        .attr('y1', (d: any) => d.source.y || 0)
        .attr('x2', (d: any) => d.target.x || 0)
        .attr('y2', (d: any) => d.target.y || 0)
        .attr('stroke-opacity', (d: any) => {
          const base = d.isUrgent ? 0.8 : 0.5;
          const fade = Math.max(0, 1 - (d.age / 40));
          return base * fade;
        });

      particleSelection
        .attr('cx', (d: any) => {
          if (!d.source.x || !d.target.x) return 0;
          const t = (time - d.offset + 1) % 1;
          return d.source.x + (d.target.x - d.source.x) * t;
        })
        .attr('cy', (d: any) => {
          if (!d.source.y || !d.target.y) return 0;
          const t = (time - d.offset + 1) % 1;
          return d.source.y + (d.target.y - d.source.y) * t;
        })
        .attr('fill-opacity', (d: any) => {
          const fade = Math.max(0, 1 - (d.age / 40));
          return d.opacity * fade;
        });

      nodeSelection.select('.ripple-indicator')
        .attr('r', (d: any) => {
          if (activeSourceAgentIds.has(d.id) || activeTargetAgentIds.has(d.id)) {
            const baseSize = 12 + (d.energy / 10);
            const size = d.id === selectedAgentId ? baseSize * 1.5 : baseSize;
            return size + (rippleT * 20);
          }
          return 0;
        })
        .attr('stroke-opacity', (d: any) => {
          if (activeSourceAgentIds.has(d.id) || activeTargetAgentIds.has(d.id)) {
            return Math.max(0, 1 - (rippleT * 1.5));
          }
          return 0;
        });

      nodeSelection.attr('transform', (d: any) => `translate(${d.x || 0},${d.y || 0})`);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.1).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

  }, [agents, signals, selectedSignalId, selectedAgentId, tracedSignalIds, tracedAgentIds]);


  return (
    <div className="relative w-full h-full bg-emerald-950 rounded-2xl overflow-hidden border border-emerald-800 shadow-2xl" onClick={() => { setSelectedSignalId(null); setSelectedAgentId(null); }}>
      {agents.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-emerald-700">
          <Activity size={48} className="mb-4 opacity-20" />
          <p className="text-sm font-bold uppercase tracking-widest">No Active Organoids</p>
          <p className="text-xs mt-1">Reset simulation to initialize ecosystem</p>
        </div>
      ) : (
        <svg ref={svgRef} width={width} height={height} className="w-full h-full cursor-move" />
      )}
      <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-none bg-emerald-950/50 p-3 rounded-xl backdrop-blur-sm border border-emerald-800/50">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-600" /> Metabolic Hub
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500" /> Signal Transducer
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Resource Collector
        </div>
        <div className="h-px bg-emerald-800/50 my-1" />
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          <span className="w-2 h-2 rounded-full border border-emerald-400 animate-pulse" /> Transmitting
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-blue-400">
          <span className="w-2 h-2 rounded-full border border-blue-400 animate-pulse" /> Receiving
        </div>
        <div className="h-px bg-emerald-800/50 my-1" />
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-rose-500">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> Emergency Alert
        </div>
      </div>
      <div className="absolute bottom-4 right-4 text-[10px] font-mono text-emerald-600 pointer-events-none">
        SCROLL TO ZOOM • DRAG TO PAN • CLICK AGENT FOR MEMORY
      </div>
      
      {selectedAgent && (
        <div className="absolute top-4 right-4 bg-emerald-900/95 backdrop-blur-md border border-emerald-500/30 p-5 rounded-2xl shadow-2xl w-72 animate-in fade-in slide-in-from-right-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Organoid Memory Log</h4>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); setSelectedAgentId(null); }}
              className="p-1 hover:bg-emerald-800 rounded-lg text-emerald-500 transition-all"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mb-4">
            <div className="text-lg font-bold text-white mb-1">{selectedAgent.name}</div>
            <div className="text-[10px] text-emerald-500 uppercase tracking-widest font-bold">{selectedAgent.type}</div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <h5 className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Recent Interactions</h5>
              <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1 pr-2">
                {selectedAgent.memory.length === 0 ? (
                  <div className="text-[10px] text-emerald-800 italic">No recent interactions recorded.</div>
                ) : (
                  selectedAgent.memory.map((entry, i) => (
                    <div key={i} className="text-[10px] text-emerald-300 bg-emerald-950/50 p-2 rounded-lg border border-emerald-800/50">
                      {entry}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h5 className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Signal History</h5>
              <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1 pr-2">
                {selectedAgent.signalHistory.length === 0 ? (
                  <div className="text-[10px] text-emerald-800 italic">No signal history available.</div>
                ) : (
                  selectedAgent.signalHistory.slice(-5).reverse().map((sig, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] bg-emerald-950/50 p-2 rounded-lg border border-emerald-800/50">
                      <span className={`font-bold ${
                        sig.type === 'ALERT' ? 'text-rose-500' : 
                        sig.type === 'ATP' ? 'text-emerald-500' : 'text-indigo-400'
                      }`}>{sig.type}</span>
                      <span className="text-emerald-700 font-mono">Payload: {sig.payload.toFixed(1)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-emerald-800/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] text-emerald-600 uppercase font-bold">Health Status</span>
              <span className={`text-[10px] font-bold ${selectedAgent.health > 70 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {selectedAgent.health.toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-1 bg-emerald-950 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${selectedAgent.health > 70 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                style={{ width: `${selectedAgent.health}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {selectedSignalId && (
        <div className="absolute top-4 right-4 bg-emerald-900/90 backdrop-blur-md border border-emerald-500/30 p-4 rounded-2xl shadow-2xl max-w-xs animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Signal Trace Active</h4>
            <button 
              onClick={(e) => { e.stopPropagation(); setSelectedSignalId(null); }}
              className="p-1 hover:bg-emerald-800 rounded-lg text-emerald-500 transition-all"
            >
              <X size={14} />
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-emerald-600">Trace Depth:</span>
              <span className="text-emerald-200 font-mono">{tracedSignalIds.size} Nodes</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-emerald-600">Propagation:</span>
              <span className="text-emerald-200 font-mono">Fractal Relay</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-emerald-800/50">
            <p className="text-[10px] text-emerald-500 italic leading-relaxed">
              Visualizing the complete propagation path of the selected bio-signal through the organoid network.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Visualizer;
