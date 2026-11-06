import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart2, Radio } from 'lucide-react';
import {
  AcousticClassId,
  InspectedAcousticTelemetry,
  PsdBandBin,
  SynthesizedSignal,
} from '../utils/acousticEngine';

interface PowerSpectrumViewProps {
  signal: SynthesizedSignal;
  activePsdBands: PsdBandBin[];
  onInspectTelemetry?: (telemetry: InspectedAcousticTelemetry | null) => void;
}

export const PowerSpectrumView: React.FC<PowerSpectrumViewProps> = ({
  signal,
  activePsdBands,
  onInspectTelemetry,
}) => {
  const fftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedBandIdx, setSelectedBandIdx] = useState<number | null>(null);
  const [psdMetricMode, setPsdMetricMode] = useState<'db' | 'energy_pct'>('db');
  const [hoverFreqInfo, setHoverFreqInfo] = useState<{ freqHz: number; magDb: number } | null>(
    null
  );

  const loudestBand: PsdBandBin = useMemo(
    () => [...activePsdBands].sort((a, b) => b.energySharePct - a.energySharePct)[0],
    [activePsdBands]
  );

  const inspectedBand: PsdBandBin =
    (selectedBandIdx !== null && activePsdBands[selectedBandIdx]) || loudestBand;

  const emitBandTelemetry = (band: PsdBandBin | null) => {
    if (!onInspectTelemetry) return;
    if (!band) {
      onInspectTelemetry(null);
      return;
    }
    const regimeToClass: Record<PsdBandBin['regime'], AcousticClassId> = {
      turbine: 'normal_ambient',
      piping: 'internal_piping',
      fissure: 'hairline_fissure',
      cavitation: 'cavitation_burst',
    };
    onInspectTelemetry({
      sourcePanel: 'power_spectrum',
      label: `Band ${band.rangeLabel} (${band.regimeLabel})`,
      signatureClass: regimeToClass[band.regime],
      spectralCentroidHz: Math.round((band.freqStartHz + band.freqEndHz) / 2),
      kurtosis: Number(signal.features.kurtosis.toFixed(2)),
      mfcc1: Number((signal.features.mfcc[0] ?? -21.4).toFixed(1)),
      mfcc2: Number((signal.features.mfcc[1] ?? -2.4).toFixed(1)),
      leakProbabilityPct: Number((signal.inference.leakProbability * 100).toFixed(1)),
      spillSpeedLpm: Number(signal.inference.estimatedFlowRateLitersPerMin.toFixed(1)),
      peakFreqRangeLabel: band.rangeLabel,
      powerDbPerHz: band.psdDbPerHz,
      energySharePct: band.energySharePct,
    });
  };

  // Render smooth area-chart frequency spectrum spanning low rumbles (left) to high squeaks (right)
  useEffect(() => {
    const canvas = fftCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const maxFreq = signal.sampleRate / 2;
    const bands = [
      { label: 'CALM HUM (<0.4k)', fStart: 0, fEnd: 400, color: 'rgba(16, 185, 129, 0.08)' },
      { label: 'PEBBLES (0.4-1.8k)', fStart: 400, fEnd: 1800, color: 'rgba(245, 158, 11, 0.08)' },
      { label: 'CRACK SPRAY (1.8-4.8k)', fStart: 1800, fEnd: 4800, color: 'rgba(14, 165, 233, 0.10)' },
      { label: 'CAVITATION (>4.8k)', fStart: 4800, fEnd: maxFreq, color: 'rgba(244, 63, 94, 0.08)' },
    ];

    ctx.font = '9.5px "JetBrains Mono", monospace';
    bands.forEach((b) => {
      const x0 = (b.fStart / maxFreq) * width;
      const x1 = (b.fEnd / maxFreq) * width;
      ctx.fillStyle = b.color;
      ctx.fillRect(x0, 0, x1 - x0, height);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.stroke();

      ctx.fillStyle = '#64748B';
      const textWidth = ctx.measureText(b.label).width;
      if (x1 - x0 > textWidth + 8) {
        ctx.fillText(b.label, x0 + 5, 13);
      }
    });

    // Horizontal dB gridlines
    [-20, -40, -60, -80].forEach((db) => {
      const y = ((0 - db) / 95) * height;
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    });

    // Smooth FFT area curve
    const freqs = signal.fftFrequencies;
    const mags = signal.fftMagnitudesDb;
    const n = freqs.length;

    let peakBinIdx = 0;
    let maxMag = -120;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (mags[i] > maxMag) {
        maxMag = mags[i];
        peakBinIdx = i;
      }
      const x = (freqs[i] / maxFreq) * width;
      const y = ((0 - mags[i]) / 95) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Smooth gradient fill under area curve
    const areaGrad = ctx.createLinearGradient(0, 0, 0, height);
    areaGrad.addColorStop(0, 'rgba(14, 165, 233, 0.36)');
    areaGrad.addColorStop(0.7, 'rgba(14, 165, 233, 0.10)');
    areaGrad.addColorStop(1, 'rgba(14, 165, 233, 0.02)');
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Highlight Peak Frequency Marker
    const peakFreqHz = freqs[peakBinIdx] || signal.features.spectralCentroidHz;
    const peakX = (peakFreqHz / maxFreq) * width;
    const peakY = Math.max(14, ((0 - maxMag) / 95) * height);

    ctx.fillStyle = '#0284C7';
    ctx.beginPath();
    ctx.arc(peakX, peakY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Mark Spectral Centroid vertical line
    const centroidX = (signal.features.spectralCentroidHz / maxFreq) * width;
    ctx.strokeStyle = '#D97706';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(centroidX, 0);
    ctx.lineTo(centroidX, height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#B45309';
    ctx.fillText(
      `Centroid: ${signal.features.spectralCentroidHz.toFixed(0)} Hz`,
      Math.min(width - 125, Math.max(6, centroidX + 6)),
      height - 6
    );
  }, [signal]);

  const handleFftMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const maxFreq = signal.sampleRate / 2;
    const freqHz = relX * maxFreq;
    const binIdx = Math.min(
      signal.fftMagnitudesDb.length - 1,
      Math.floor(relX * signal.fftMagnitudesDb.length)
    );
    setHoverFreqInfo({
      freqHz: Math.round(freqHz),
      magDb: Number(signal.fftMagnitudesDb[binIdx].toFixed(1)),
    });
  };

  const regimeColorClasses: Record<
    PsdBandBin['regime'],
    { bar: string; activeBar: string; text: string; bgBadge: string }
  > = {
    turbine: {
      bar: 'bg-gradient-to-t from-emerald-600 to-teal-400 hover:from-emerald-500 hover:to-teal-300',
      activeBar:
        'bg-gradient-to-t from-emerald-500 to-teal-300 ring-2 ring-emerald-600 shadow-md shadow-emerald-600/30',
      text: 'text-emerald-700',
      bgBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    },
    piping: {
      bar: 'bg-gradient-to-t from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300',
      activeBar:
        'bg-gradient-to-t from-amber-400 to-yellow-300 ring-2 ring-amber-600 shadow-md shadow-amber-600/30',
      text: 'text-amber-700',
      bgBadge: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    fissure: {
      bar: 'bg-gradient-to-t from-sky-600 to-cyan-400 hover:from-sky-500 hover:to-cyan-300',
      activeBar:
        'bg-gradient-to-t from-sky-500 to-cyan-300 ring-2 ring-sky-600 shadow-md shadow-sky-600/30',
      text: 'text-sky-700',
      bgBadge: 'bg-sky-50 text-sky-800 border-sky-200',
    },
    cavitation: {
      bar: 'bg-gradient-to-t from-rose-600 to-orange-400 hover:from-rose-500 hover:to-orange-300',
      activeBar:
        'bg-gradient-to-t from-rose-500 to-orange-300 ring-2 ring-rose-600 shadow-md shadow-rose-600/30',
      text: 'text-rose-700',
      bgBadge: 'bg-rose-50 text-rose-800 border-rose-200',
    },
  };

  return (
    <div
      data-testid="psd-bar-chart-card"
      className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4 flex flex-col justify-between h-full w-full gap-3"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <BarChart2 className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Live Sound Energy Bars (Power Spectral Density)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Smooth area spectrum &amp; 16 sound bars from low rumbles (left) to high squeaks (right)
          </p>
        </div>

        {/* Interactive Metric Scale Switcher */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-100/90 rounded-lg border border-slate-200 shrink-0 shadow-2xs">
          <button
            type="button"
            onClick={() => setPsdMetricMode('db')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
              psdMetricMode === 'db'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Loudness (dB/Hz)
          </button>
          <button
            type="button"
            onClick={() => setPsdMetricMode('energy_pct')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
              psdMetricMode === 'energy_pct'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Energy Share (%)
          </button>
        </div>
      </div>

      {/* Main Content Stage (flex-1 stretches vertically to eliminate blank gaps) */}
      <div className="flex-1 flex flex-col justify-between gap-2.5 min-h-0">
        {/* 1. Smooth Area-Chart Frequency Spectrum Canvas */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1 px-0.5">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Radio className="w-3 h-3 text-sky-600" />
              Sound Pitch Area Curve (0–8.0 kHz)
            </span>
            <span className="font-mono tabular-nums">
              {hoverFreqInfo ? (
                <span>
                  Pitch: <strong className="text-sky-700">{hoverFreqInfo.freqHz} Hz</strong> /{' '}
                  {hoverFreqInfo.magDb} dB
                </span>
              ) : (
                <span>
                  Centroid: <strong className="text-sky-700">{signal.features.spectralCentroidHz.toFixed(0)} Hz</strong> · Ceiling: <strong>{signal.features.spectralRolloffHz.toFixed(0)} Hz</strong>
                </span>
              )}
            </span>
          </div>
          <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shadow-2xs">
            <canvas
              ref={fftCanvasRef}
              width={760}
              height={92}
              data-testid="fft-canvas"
              onMouseMove={handleFftMouseMove}
              onMouseLeave={() => setHoverFreqInfo(null)}
              className="w-full h-[92px] block cursor-crosshair"
            />
          </div>
        </div>

        {/* 2. Interactive 16-Bar PSD Histogram & Peak Readout (flex-1) */}
        <div
          className="flex-1 relative bg-slate-900/95 border border-slate-800 rounded-lg p-2.5 pt-3.5 shadow-inner flex flex-col justify-between"
          onMouseLeave={() => emitBandTelemetry(null)}
        >
          <div
            data-testid="psd-bar-chart-bars"
            className="flex-1 min-h-[78px] flex items-end justify-between gap-1.5 border-b border-slate-800/80 pb-1"
          >
            {activePsdBands.map((band) => {
              const heightPct =
                psdMetricMode === 'db'
                  ? Math.max(6, Math.min(100, ((band.psdDbPerHz + 85) / 78) * 100))
                  : Math.max(6, Math.min(100, (band.energySharePct / 45) * 100));

              const isSelected = selectedBandIdx === band.bandIndex;
              const palette = regimeColorClasses[band.regime];

              return (
                <button
                  key={band.bandIndex}
                  type="button"
                  aria-label={`Band ${band.rangeLabel}: ${band.psdDbPerHz} dB/Hz (${band.energySharePct}% energy)`}
                  onClick={() => {
                    const nextIdx = isSelected ? null : band.bandIndex;
                    setSelectedBandIdx(nextIdx);
                    emitBandTelemetry(nextIdx !== null ? band : null);
                  }}
                  onMouseEnter={() => {
                    setSelectedBandIdx(band.bandIndex);
                    emitBandTelemetry(band);
                  }}
                  className="flex-1 h-full flex flex-col justify-end items-center group focus:outline-none cursor-pointer"
                >
                  <span className="text-[9px] font-mono text-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity mb-0.5 tabular-nums font-bold">
                    {psdMetricMode === 'db'
                      ? `${band.psdDbPerHz.toFixed(0)}`
                      : `${band.energySharePct.toFixed(0)}%`}
                  </span>
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-t-sm transition-all duration-150 ${
                      isSelected ? palette.activeBar : palette.bar
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* X-Axis Frequency Band Labels */}
          <div className="flex items-center justify-between gap-1.5 pt-1">
            {activePsdBands.map((band) => (
              <div
                key={band.bandIndex}
                className="flex-1 text-center text-[9.5px] font-mono text-slate-400 tabular-nums truncate"
              >
                {band.bandIndex % 2 === 1 ? band.label : ''}
              </div>
            ))}
          </div>

          {/* Inspected Band Telemetry Readout Bar */}
          {inspectedBand && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
              <div className="flex items-center gap-2">
                <span className="font-sans font-bold text-slate-200">
                  {selectedBandIdx !== null ? 'Inspected Bar:' : 'Loudest Peak:'}
                </span>
                <span className="font-bold text-cyan-400">{inspectedBand.rangeLabel}</span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold border ${
                    regimeColorClasses[inspectedBand.regime].bgBadge
                  }`}
                >
                  {inspectedBand.regimeLabel}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-300 text-[11px]">
                <span>
                  Power: <strong className="text-white">{inspectedBand.psdDbPerHz.toFixed(1)}</strong>{' '}
                  dB/Hz
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span>
                  Share:{' '}
                  <strong className="text-white">{inspectedBand.energySharePct.toFixed(1)}%</strong>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4-Regime Aggregate Spectral Energy Share Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] font-bold text-emerald-800 whitespace-nowrap">
            Calm Hum (Green)
          </div>
          <div className="font-mono text-sm font-extrabold text-emerald-700 tabular-nums mt-0.5">
            {(signal.features.subBandLowRatio * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] font-bold text-amber-800 whitespace-nowrap">
            Pebbles (Gold)
          </div>
          <div className="font-mono text-sm font-extrabold text-amber-700 tabular-nums mt-0.5">
            {(signal.features.subBandMidRatio * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-sky-50/70 border border-sky-200/80 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] font-bold text-sky-800 whitespace-nowrap">
            Crack Spray (Blue)
          </div>
          <div className="font-mono text-sm font-extrabold text-sky-700 tabular-nums mt-0.5">
            {(signal.features.subBandHighRatio * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-rose-50/70 border border-rose-200/80 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] font-bold text-rose-800 whitespace-nowrap">
            Pop Bubbles (Red)
          </div>
          <div className="font-mono text-sm font-extrabold text-rose-700 tabular-nums mt-0.5">
            {(signal.features.subBandUltraRatio * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
};
