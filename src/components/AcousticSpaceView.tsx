import React, { useMemo, useState } from 'react';
import { Compass, Crosshair, Play, Sparkles } from 'lucide-react';
import {
  AcousticClassId,
  AcousticSpacePoint,
  GeneratorParams,
  InspectedAcousticTelemetry,
  SoundHistoryItem,
  SynthesizedSignal,
  generateAcousticSpaceEmbeddingDataset,
} from '../utils/acousticEngine';

interface AcousticSpaceViewProps {
  signal: SynthesizedSignal;
  recentHistory?: SoundHistoryItem[];
  onSelectPointParams?: (params: GeneratorParams) => void;
  onInspectTelemetry?: (telemetry: InspectedAcousticTelemetry | null) => void;
}

const CATEGORY_FILTERS: {
  id: 'all' | AcousticClassId;
  label: string;
  dotHex: string;
}[] = [
  { id: 'all', label: 'All Clusters', dotHex: '#64748B' },
  { id: 'normal_ambient', label: 'Calm', dotHex: '#10B981' },
  { id: 'internal_piping', label: 'Pebbles', dotHex: '#F59E0B' },
  { id: 'hairline_fissure', label: 'Fissure Sprays', dotHex: '#0EA5E9' },
  { id: 'cavitation_burst', label: 'Cavitation', dotHex: '#F43F5E' },
];

export const AcousticSpaceView: React.FC<AcousticSpaceViewProps> = ({
  signal,
  recentHistory = [],
  onSelectPointParams,
  onInspectTelemetry,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'all' | AcousticClassId>('all');
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [pinnedPointId, setPinnedPointId] = useState<string | null>(null);

  const allPoints = useMemo(
    () => generateAcousticSpaceEmbeddingDataset(signal, recentHistory),
    [signal, recentHistory]
  );

  const visiblePoints = useMemo(() => {
    if (categoryFilter === 'all') return allPoints;
    return allPoints.filter((p) => p.signatureClass === categoryFilter || p.isCurrentActive);
  }, [allPoints, categoryFilter]);

  const activePoint: AcousticSpacePoint = useMemo(() => {
    if (hoveredPointId) {
      const found = allPoints.find((p) => p.id === hoveredPointId);
      if (found) return found;
    }
    if (pinnedPointId) {
      const found = allPoints.find((p) => p.id === pinnedPointId);
      if (found) return found;
    }
    return allPoints.find((p) => p.isCurrentActive) || allPoints[0];
  }, [allPoints, hoveredPointId, pinnedPointId]);

  const emitTelemetry = (pt: AcousticSpacePoint | null) => {
    if (!onInspectTelemetry) return;
    if (!pt) {
      onInspectTelemetry(null);
      return;
    }
    onInspectTelemetry({
      sourcePanel: 'acoustic_space',
      label: `Test #${pt.seed} (${pt.whimsicalName})`,
      seed: pt.seed,
      signatureClass: pt.signatureClass,
      spectralCentroidHz: pt.spectralCentroidHz,
      kurtosis: pt.kurtosis,
      mfcc1: pt.mfcc1,
      mfcc2: pt.mfcc2,
      leakProbabilityPct: pt.leakProbabilityPct,
      spillSpeedLpm: pt.spillSpeedLpm,
      peakFreqRangeLabel: pt.peakFreqRangeLabel,
    });
  };

  // Convert normalized [-100, 100] coordinates to SVG viewBox [0, 440] x [0, 270]
  const toSvgX = (embedX: number) => 220 + (embedX / 100) * 185;
  const toSvgY = (embedY: number) => 135 - (embedY / 100) * 108;

  // Build SVG polyline for the Polaroid mini thumbnail waveform
  const miniWaveformPath = useMemo(() => {
    const pts = activePoint.miniWavePoints;
    return pts
      .map((val, idx) => {
        const x = 6 + (idx / (pts.length - 1)) * 168;
        const y = 32 - val * 20;
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [activePoint]);

  return (
    <div
      data-testid="acoustic-space-panel"
      className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4 flex flex-col justify-between h-full w-full gap-3"
    >
      {/* Panel Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
              <Compass className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Acoustic Space (2D Embedding Map)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            2D feature map clustered by MFCCs &amp; spectral centroid · Hover or click any point to sync ML clues!
          </p>
        </div>

        {/* Cluster Filter Bar */}
        <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100/90 rounded-lg border border-slate-200 text-[11px] font-semibold">
          {CATEGORY_FILTERS.map((cat) => {
            const isSelected = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-all cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat.id !== 'all' && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: cat.dotHex }}
                  />
                )}
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main 2D Scatter Canvas + Polaroid Preview Split Stage (flex-1 stretches to fill row) */}
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-3 items-stretch min-h-0">
        {/* Left 7 Cols: Interactive 2D Embedding Scatter Plot */}
        <div className="sm:col-span-7 relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950 shadow-inner flex flex-col justify-between h-full">
          <div className="flex-1 relative min-h-[210px] flex items-center justify-center">
            <svg
              viewBox="0 0 440 270"
              preserveAspectRatio="xMidYMid meet"
              data-testid="acoustic-space-svg"
              className="w-full h-full block select-none"
            >
              <defs>
                <radialGradient id="clusterCalm" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="clusterPebbles" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="clusterFissure" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="clusterCavitation" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#F43F5E" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Subtle 2D Embedding Coordinate Grid */}
              <g stroke="rgba(148, 163, 184, 0.12)" strokeWidth="1">
                <line x1="0" y1="67" x2="440" y2="67" />
                <line x1="0" y1="202" x2="440" y2="202" />
                <line x1="110" y1="0" x2="110" y2="270" />
                <line x1="330" y1="0" x2="330" y2="270" />
              </g>

              {/* Principal Component Axes */}
              <g stroke="rgba(148, 163, 184, 0.28)" strokeWidth="1" strokeDasharray="4 4">
                <line x1="0" y1="135" x2="440" y2="135" />
                <line x1="220" y1="0" x2="220" y2="270" />
              </g>

              {/* Soft Cluster Density Ellipses */}
              <ellipse cx={toSvgX(-52)} cy={toSvgY(-46)} rx="78" ry="52" fill="url(#clusterCalm)" />
              <ellipse cx={toSvgX(-46)} cy={toSvgY(46)} rx="78" ry="52" fill="url(#clusterPebbles)" />
              <ellipse cx={toSvgX(50)} cy={toSvgY(48)} rx="82" ry="54" fill="url(#clusterFissure)" />
              <ellipse cx={toSvgX(52)} cy={toSvgY(-48)} rx="82" ry="54" fill="url(#clusterCavitation)" />

              {/* Quadrant Cluster Watermark Labels */}
              <text x="18" y="22" fill="#FBBF24" fillOpacity="0.85" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="bold">
                PEBBLES (PIPING)
              </text>
              <text x="285" y="22" fill="#38BDF8" fillOpacity="0.88" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="bold">
                FISSURE SPRAYS
              </text>
              <text x="18" y="256" fill="#34D399" fillOpacity="0.85" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="bold">
                CALM HUM (SAFE)
              </text>
              <text x="295" y="256" fill="#FB7185" fillOpacity="0.88" fontSize="9.5" fontFamily="JetBrains Mono, monospace" fontWeight="bold">
                CAVITATION
              </text>

              {/* Crosshair lines to currently inspected point */}
              {activePoint && (
                <g stroke={activePoint.colorHex} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 2">
                  <line
                    x1={toSvgX(activePoint.embedX)}
                    y1="0"
                    x2={toSvgX(activePoint.embedX)}
                    y2="270"
                  />
                  <line
                    x1="0"
                    y1={toSvgY(activePoint.embedY)}
                    x2="440"
                    y2={toSvgY(activePoint.embedY)}
                  />
                </g>
              )}

              {/* Scatter Points */}
              {visiblePoints.map((pt) => {
                const cx = toSvgX(pt.embedX);
                const cy = toSvgY(pt.embedY);
                const isInspected = activePoint.id === pt.id;

                return (
                  <g
                    key={pt.id}
                    data-testid={`acoustic-space-point-${pt.seed}`}
                    className="cursor-pointer"
                    onMouseEnter={() => {
                      setHoveredPointId(pt.id);
                      emitTelemetry(pt);
                    }}
                    onMouseLeave={() => {
                      setHoveredPointId(null);
                      emitTelemetry(null);
                    }}
                    onClick={() => {
                      setPinnedPointId(pt.id);
                      emitTelemetry(pt);
                      if (onSelectPointParams) {
                        onSelectPointParams(pt.params);
                      }
                    }}
                  >
                    {(pt.isCurrentActive || isInspected) && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={pt.isCurrentActive ? 12 : 9.5}
                        fill="none"
                        stroke={pt.colorHex}
                        strokeWidth={isInspected ? 2 : 1.5}
                        strokeOpacity={isInspected ? 0.95 : 0.7}
                      />
                    )}

                    <circle
                      cx={cx}
                      cy={cy}
                      r={pt.isCurrentActive ? 6.2 : isInspected ? 5.6 : 4.2}
                      fill={pt.colorHex}
                      stroke={pt.isCurrentActive || isInspected ? '#FFFFFF' : '#0F172A'}
                      strokeWidth={pt.isCurrentActive || isInspected ? 2 : 1}
                    />

                    {pt.isCurrentActive && (
                      <text
                        x={cx}
                        y={cy - 14}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize="8.5"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="bold"
                      >
                        LIVE #{pt.seed}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Bottom Axis Footer inside Scatter Plot */}
          <div className="px-2.5 py-1.5 bg-slate-900/95 border-t border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-300">
            <span>X: Centroid + MFCC c1</span>
            <span>Y: Kurtosis + MFCC c2</span>
          </div>
        </div>

        {/* Right 5 Cols: Floating Polaroid-Style Preview Card with Full Synchronized ML Metrics */}
        <div className="sm:col-span-5 flex flex-col h-full">
          <div
            data-testid="acoustic-space-polaroid"
            className="bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/95 shadow-xs flex flex-col justify-between h-full gap-2"
          >
            {/* Polaroid Top Mini Thumbnail Frame */}
            <div className="relative rounded overflow-hidden bg-slate-950 border border-slate-800 p-2 flex flex-col justify-between min-h-[96px]">
              <div className="flex items-center justify-between gap-1 z-10">
                <span className="font-mono text-[10px] font-bold text-white bg-slate-900/90 px-1.5 py-0.5 rounded border border-slate-700 tabular-nums">
                  TEST #{activePoint.seed}
                </span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded text-slate-950"
                  style={{ backgroundColor: activePoint.colorHex }}
                >
                  {activePoint.categoryLabel}
                </span>
              </div>

              {/* Mini Acoustic Waveform & Dam Crack Visual Thumbnail SVG */}
              <svg viewBox="0 0 180 64" className="w-full h-12 overflow-visible my-0.5">
                {activePoint.miniWavePoints.map((v, i) => {
                  const bh = Math.max(4, Math.abs(v) * 40);
                  return (
                    <rect
                      key={i}
                      x={6 + i * 8.6}
                      y={32 - bh / 2}
                      width="4.5"
                      height={bh}
                      rx="1"
                      fill={activePoint.colorHex}
                      fillOpacity="0.24"
                    />
                  );
                })}
                <path
                  d={miniWaveformPath}
                  fill="none"
                  stroke={activePoint.colorHex}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <div className="flex items-center justify-between text-[9.5px] font-mono text-slate-300 z-10">
                <span>Peak: {activePoint.peakFreqRangeLabel}</span>
                <span className="text-amber-300 font-bold">Depth: {activePoint.hydrostaticHeadM}m</span>
              </div>
            </div>

            {/* Polaroid Caption & Synchronized 6-Metric Grid */}
            <div className="flex-1 flex flex-col justify-between gap-2">
              <div className="flex items-start justify-between gap-1 px-0.5">
                <div className="min-w-0">
                  <div
                    data-testid="polaroid-sound-name"
                    className="text-xs font-extrabold text-slate-900 truncate"
                  >
                    &ldquo;{activePoint.whimsicalName}&rdquo;
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium truncate">
                    {activePoint.isCurrentActive ? 'Active Workbench Signal' : 'Click to Sync with Builder'}
                  </div>
                </div>
                <Crosshair
                  className="w-3.5 h-3.5 shrink-0 mt-0.5"
                  style={{ color: activePoint.colorHex }}
                />
              </div>

              {/* Coupled 6-Cell ML & Physical Telemetry Matrix (Zero empty space) */}
              <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-white p-2 rounded-md border border-slate-200/90 font-mono tabular-nums">
                <div>
                  <span className="text-slate-400 block text-[9px] font-sans uppercase">
                    Crack Size
                  </span>
                  <strong
                    data-testid="polaroid-crack-size"
                    className="text-slate-900 font-bold"
                  >
                    {activePoint.orificeDiameterMm.toFixed(1)} mm
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-sans uppercase">
                    Leak Risk %
                  </span>
                  <strong
                    data-testid="polaroid-risk-pct"
                    className={
                      activePoint.leakProbabilityPct > 60
                        ? 'text-rose-600 font-bold'
                        : activePoint.leakProbabilityPct > 25
                        ? 'text-amber-600 font-bold'
                        : 'text-emerald-600 font-bold'
                    }
                  >
                    {activePoint.leakProbabilityPct}%
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-sans uppercase">
                    Spill Speed
                  </span>
                  <strong className="text-sky-700 font-bold">
                    {activePoint.spillSpeedLpm} L/m
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-sans uppercase">
                    Centroid
                  </span>
                  <strong className="text-slate-900 font-bold">
                    {activePoint.spectralCentroidHz} Hz
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-sans uppercase">
                    Kurtosis
                  </span>
                  <strong className="text-slate-900 font-bold">
                    {activePoint.kurtosis}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] font-sans uppercase">
                    MFCC c1/c2
                  </span>
                  <strong className="text-slate-900 font-bold">
                    {activePoint.mfcc1}/{activePoint.mfcc2}
                  </strong>
                </div>
              </div>

              {onSelectPointParams && (
                <button
                  type="button"
                  data-testid="polaroid-inspect-btn"
                  onClick={() => onSelectPointParams(activePoint.params)}
                  className="w-full py-1.5 px-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>
                    {activePoint.isCurrentActive ? 'Synced in Builder' : 'Load Test in Builder'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Legend Bar */}
      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            Calm
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
            Pebbles
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
            Fissure Sprays
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
            Cavitation
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-500 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-violet-500" />
          {visiblePoints.length} Tests · Centroid {signal.features.spectralCentroidHz.toFixed(0)} Hz
        </span>
      </div>
    </div>
  );
};
