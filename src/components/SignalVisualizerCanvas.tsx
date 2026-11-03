import React, { useEffect, useRef, useState } from 'react';
import { Activity, BarChart2, CircleDot, Layers, Radio, Volume2, Waves, Zap } from 'lucide-react';
import {
  PsdBandBin,
  SynthesizedSignal,
  calculateAcousticPulseState,
  calculateAcousticPulsePeriodMs,
  calculateAcousticAttenuation,
} from '../utils/acousticEngine';
import { D3FrequencySpectrum, CharacteristicBandsLegend } from './D3FrequencySpectrum';

interface SignalVisualizerCanvasProps {
  signal: SynthesizedSignal;
  isPlaying: boolean;
}

export const SignalVisualizerCanvas: React.FC<SignalVisualizerCanvasProps> = ({
  signal,
  isPlaying,
}) => {
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hoverFreqInfo, setHoverFreqInfo] = useState<{ freqHz: number; magDb: number } | null>(
    null
  );
  const [hoverWaveInfo, setHoverWaveInfo] = useState<{ timeMs: number; ampPa: number } | null>(
    null
  );
  const [visualizerMode, setVisualizerMode] = useState<'waveform' | 'spectrum' | 'dual_overlay'>('waveform');
  const [hoverSpectrumInfo, setHoverSpectrumInfo] = useState<{
    freqHz: number;
    magDb: number;
    bandName: string;
    leakRisk: string;
  } | null>(null);
  const [selectedBandIdx, setSelectedBandIdx] = useState<number | null>(null);
  const [psdMetricMode, setPsdMetricMode] = useState<'db' | 'energy_pct'>('db');
  const [liveFrameIdx, setLiveFrameIdx] = useState<number | null>(null);

  const distanceM = signal.params.sensorDistanceM;
  const pulseTele = React.useMemo(
    () => calculateAcousticPulseState(0, distanceM),
    [distanceM]
  );

  // Cycle through STFT frames in real time while audio is playing
  useEffect(() => {
    if (!isPlaying) {
      setLiveFrameIdx(null);
      return;
    }
    let frame = 0;
    const totalFrames = signal.spectrogramFrames.length || 36;
    const intervalMs = Math.max(40, Math.floor((signal.params.durationSec * 1000) / totalFrames));
    const timer = window.setInterval(() => {
      setLiveFrameIdx(frame % totalFrames);
      frame += 1;
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, signal]);

  // Compute real-time frame-modulated PSD bands when playing or scrubbing a time slice
  const activePsdBands: PsdBandBin[] = React.useMemo(() => {
    if (liveFrameIdx === null || !signal.spectrogramFrames[liveFrameIdx]) {
      return signal.psdBands;
    }
    const frameBins = signal.spectrogramFrames[liveFrameIdx]; // 64 bins in dB
    const binsPerBand = Math.max(1, Math.floor(frameBins.length / signal.psdBands.length));
    const rawLinear: number[] = [];
    const frameDb: number[] = [];

    for (let b = 0; b < signal.psdBands.length; b++) {
      let sumLin = 0;
      for (let j = 0; j < binsPerBand; j++) {
        const idx = Math.min(frameBins.length - 1, b * binsPerBand + j);
        sumLin += Math.pow(10, frameBins[idx] / 10);
      }
      const avgLin = sumLin / binsPerBand;
      rawLinear.push(avgLin);
      frameDb.push(Number(Math.max(-95, Math.min(0, 10 * Math.log10(avgLin + 1e-10))).toFixed(1)));
    }

    const totalLin = rawLinear.reduce((acc, v) => acc + v, 0) + 1e-12;
    return signal.psdBands.map((band, idx) => ({
      ...band,
      psdDbPerHz: frameDb[idx],
      energySharePct: Number(((rawLinear[idx] / totalLin) * 100).toFixed(1)),
    }));
  }, [signal, liveFrameIdx]);

  // Render Spectrogram Waterfall
  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const frames = signal.spectrogramFrames;
    const numTimeSlices = frames.length;
    const numFreqBins = frames[0]?.length || 64;

    const cellW = width / numTimeSlices;
    const cellH = height / numFreqBins;

    for (let t = 0; t < numTimeSlices; t++) {
      const col = frames[t];
      for (let f = 0; f < numFreqBins; f++) {
        const db = col[f];
        // Normalize -85dB .. -5dB to 0..1
        const norm = Math.max(0, Math.min(1, (db + 85) / 80));
        // Scientific Viridis / Telemetry Cyan-Amber ramp
        let r = 11;
        let g = 18;
        let b = 33;
        if (norm < 0.35) {
          const k = norm / 0.35;
          r = Math.round(11 + k * 8);
          g = Math.round(18 + k * 65);
          b = Math.round(33 + k * 110);
        } else if (norm < 0.72) {
          const k = (norm - 0.35) / 0.37;
          r = Math.round(19 + k * 15);
          g = Math.round(83 + k * 115);
          b = Math.round(143 + k * 75);
        } else {
          const k = (norm - 0.72) / 0.28;
          r = Math.round(34 + k * 215);
          g = Math.round(198 - k * 35);
          b = Math.round(218 - k * 190);
        }

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        // Low frequency at bottom, high frequency at top
        const y = height - (f + 1) * cellH;
        ctx.fillRect(
          Math.floor(t * cellW),
          Math.floor(y),
          Math.ceil(cellW) + 1,
          Math.ceil(cellH) + 1
        );
      }
    }

    // Draw horizontal frequency gridlines (2kHz, 4kHz, 6kHz)
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(241, 245, 249, 0.82)';

    const maxFreq = signal.sampleRate / 2;
    [1000, 2000, 4000, 6000].forEach((freq) => {
      if (freq < maxFreq) {
        const y = height - (freq / maxFreq) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(`${(freq / 1000).toFixed(0)} kHz`, 8, y - 4);
      }
    });
  }, [signal]);

  // Render FFT Power Spectral Density Curve
  useEffect(() => {
    const canvas = fftCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Background structural regime bands
    const maxFreq = signal.sampleRate / 2;
    const bands = [
      { label: 'TURBINE', fStart: 0, fEnd: 400, color: 'rgba(148, 163, 184, 0.08)' },
      { label: 'PIPING (0.4-1.8k)', fStart: 400, fEnd: 1800, color: 'rgba(245, 158, 11, 0.07)' },
      { label: 'FISSURE JET (1.8-4.8k)', fStart: 1800, fEnd: 4800, color: 'rgba(6, 182, 212, 0.08)' },
      { label: 'CAVITATION (>4.8k)', fStart: 4800, fEnd: maxFreq, color: 'rgba(225, 29, 72, 0.07)' },
    ];

    ctx.font = '10px "JetBrains Mono", monospace';
    bands.forEach((b) => {
      const x0 = (b.fStart / maxFreq) * width;
      const x1 = (b.fEnd / maxFreq) * width;
      ctx.fillStyle = b.color;
      ctx.fillRect(x0, 0, x1 - x0, height);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.stroke();

      ctx.fillStyle = '#64748B';
      const textWidth = ctx.measureText(b.label).width;
      if (x1 - x0 > textWidth + 10) {
        ctx.fillText(b.label, x0 + 6, 14);
      }
    });

    // Horizontal dB gridlines
    [-20, -40, -60, -80].forEach((db) => {
      const y = ((0 - db) / 95) * height;
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    });

    // Plot FFT curve
    const freqs = signal.fftFrequencies;
    const mags = signal.fftMagnitudesDb;
    const n = freqs.length;

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (freqs[i] / maxFreq) * width;
      const y = ((0 - mags[i]) / 95) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = 1.75;
    ctx.stroke();

    // Subtle area fill under curve
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(2, 132, 199, 0.12)';
    ctx.fill();

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
      height - 8
    );
  }, [signal]);

  const animFrameIdRef = useRef<number | null>(null);

  // Render Time-Domain Waveform with Distance-Dependent Pulsing Acoustic Wavefront Rings
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isMounted = true;
    const distanceM = signal.params.sensorDistanceM;

    const render = (now: number) => {
      if (!isMounted) return;

      const width = canvas.width;
      const height = canvas.height;
      const midX = width / 2;
      const midY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // 1. Subtle background grid & time division marks
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      // Time ticks every 152px (~15 ms increments)
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.35)';
      ctx.fillStyle = '#94A3B8';
      ctx.font = '9px "JetBrains Mono", monospace';
      const tickStep = width / 5;
      for (let step = 1; step < 5; step++) {
        const x = step * tickStep;
        ctx.beginPath();
        ctx.moveTo(x, midY - 6);
        ctx.lineTo(x, midY + 6);
        ctx.stroke();
        const tickMs = ((step / 5) * (1200 / signal.sampleRate) * 1000).toFixed(0);
        ctx.fillText(`${tickMs}ms`, x - 12, height - 6);
      }

      // 2. Compute dynamic acoustic pulse state based on Microphone Distance parameter
      // Pulse speed slows down as distance increases (e.g. 1m -> ~81 BPM / 1.35 Hz; 25m -> ~21 BPM / 0.36 Hz)
      const pulse = calculateAcousticPulseState(now, distanceM, 64, 3);

      // 3. Draw pulsing acoustic wavefront rings around the visualized signal
      // Concentric elliptical rings expand outward around the hydrophone sensor and waveform
      pulse.wavefronts.forEach((ring) => {
        // Horizontal radius expands proportionally to canvas aspect ratio
        const rx = ring.radiusPx * 2.3;
        const ry = ring.radiusPx * 0.88;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(midX, midY, rx, ry, 0, 0, Math.PI * 2);

        // Soft radial gradient fill for the acoustic wavefront
        const grad = ctx.createRadialGradient(midX, midY, 4, midX, midY, rx);
        grad.addColorStop(0, `rgba(14, 165, 233, ${ring.opacity * 0.14})`);
        grad.addColorStop(0.65, `rgba(14, 165, 233, ${ring.opacity * 0.05})`);
        grad.addColorStop(1, 'rgba(14, 165, 233, 0)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Pulsing ring perimeter stroke
        ctx.strokeStyle = `rgba(2, 132, 199, ${ring.opacity})`;
        ctx.lineWidth = ring.lineWidth;
        if (distanceM > 20) {
          ctx.setLineDash([6, 3]); // dashed wavefront for distant/dispersed acoustic waves
        }
        ctx.stroke();
        ctx.restore();
      });

      // 4. Hydrophone Center Sensor Pin & Distance Readout
      ctx.save();
      // Outer subtle sensor glow
      const sensorGlow = ctx.createRadialGradient(midX, midY, 1, midX, midY, 14);
      sensorGlow.addColorStop(0, 'rgba(2, 132, 199, 0.45)');
      sensorGlow.addColorStop(1, 'rgba(2, 132, 199, 0)');
      ctx.fillStyle = sensorGlow;
      ctx.beginPath();
      ctx.arc(midX, midY, 14, 0, Math.PI * 2);
      ctx.fill();

      // Sensor center dot
      ctx.fillStyle = '#0284C7';
      ctx.beginPath();
      ctx.arc(midX, midY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Sensor label
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillStyle = '#0369A1';
      ctx.textAlign = 'center';
      ctx.fillText(`HYDROPHONE @ ${distanceM.toFixed(1)}m`, midX, 16);
      ctx.restore();

      // 5. Draw Time-Domain Waveform Signal across the canvas
      // When audio is playing, add live frame offset; when paused, show crisp frozen wave
      const samples = signal.samples;
      const viewCount = Math.min(samples.length, 1200);
      const phaseOffset = isPlaying ? Math.floor((now / 18) % Math.max(1, samples.length - viewCount - 1)) : 0;

      ctx.beginPath();
      for (let i = 0; i < viewCount; i++) {
        const sampleIdx = Math.min(samples.length - 1, i + phaseOffset);
        const x = (i / (viewCount - 1)) * width;
        const y = midY - samples[sampleIdx] * (midY * 0.82);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = isPlaying ? '#0D9488' : '#0F172A';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // 6. Real-time playhead sweep line when audio is playing
      if (isPlaying) {
        const playheadX = ((now / 1400) % 1) * width;
        ctx.strokeStyle = 'rgba(13, 148, 136, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
      }

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      isMounted = false;
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [signal, isPlaying]);

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

  const handleWaveMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const viewCount = Math.min(signal.samples.length, 1200);
    const idx = Math.min(viewCount - 1, Math.floor(relX * viewCount));
    const timeMs = (idx / signal.sampleRate) * 1000;
    const ampPa = signal.samples[idx] * 120; // calibrated hydrophone Pa scale
    setHoverWaveInfo({
      timeMs: Number(timeMs.toFixed(2)),
      ampPa: Number(ampPa.toFixed(2)),
    });
  };

  const inspectedBand: PsdBandBin =
    (selectedBandIdx !== null && activePsdBands[selectedBandIdx]) ||
    [...activePsdBands].sort((a, b) => b.energySharePct - a.energySharePct)[0];

  const regimeColorClasses: Record<
    PsdBandBin['regime'],
    { bar: string; activeBar: string; text: string; bgBadge: string }
  > = {
    turbine: {
      bar: 'bg-gradient-to-t from-emerald-600 to-teal-400 hover:from-emerald-500 hover:to-teal-300',
      activeBar: 'bg-gradient-to-t from-emerald-500 to-teal-300 ring-2 ring-emerald-600 shadow-md shadow-emerald-600/30',
      text: 'text-emerald-700',
      bgBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    },
    piping: {
      bar: 'bg-gradient-to-t from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300',
      activeBar: 'bg-gradient-to-t from-amber-400 to-yellow-300 ring-2 ring-amber-600 shadow-md shadow-amber-600/30',
      text: 'text-amber-700',
      bgBadge: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    fissure: {
      bar: 'bg-gradient-to-t from-sky-600 to-cyan-400 hover:from-sky-500 hover:to-cyan-300',
      activeBar: 'bg-gradient-to-t from-sky-500 to-cyan-300 ring-2 ring-sky-600 shadow-md shadow-sky-600/30',
      text: 'text-sky-700',
      bgBadge: 'bg-sky-50 text-sky-800 border-sky-200',
    },
    cavitation: {
      bar: 'bg-gradient-to-t from-rose-600 to-orange-400 hover:from-rose-500 hover:to-orange-300',
      activeBar: 'bg-gradient-to-t from-rose-500 to-orange-300 ring-2 ring-rose-600 shadow-md shadow-rose-600/30',
      text: 'text-rose-700',
      bgBadge: 'bg-rose-50 text-rose-800 border-rose-200',
    },
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Real-Time Power Spectral Density (PSD) Bar Chart Card */}
      <div
        data-testid="psd-bar-chart-card"
        className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <BarChart2 className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Live Sound Energy Bars (Power Spectral Density)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              16 sound bars from low rumbles (left) to high squeaks (right) · Click any bar to inspect!
            </p>
          </div>

          {/* Interactive Metric Scale Switcher */}
          <div className="flex items-center gap-1 p-0.5 bg-slate-100/90 rounded-lg border border-slate-200 shrink-0 shadow-2xs">
            <button
              type="button"
              onClick={() => setPsdMetricMode('db')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
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
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                psdMetricMode === 'energy_pct'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Energy Share (%)
            </button>
          </div>
        </div>

        {/* Interactive 16-Bar PSD Histogram */}
        <div className="relative bg-slate-900/95 border border-slate-800 rounded-lg p-3.5 pt-5 shadow-inner">
          <div
            data-testid="psd-bar-chart-bars"
            className="h-[136px] flex items-end justify-between gap-1.5 border-b border-slate-800/80 pb-1"
          >
            {activePsdBands.map((band) => {
              // Calculate normalized bar height (8% to 100%)
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
                  onClick={() =>
                    setSelectedBandIdx(isSelected ? null : band.bandIndex)
                  }
                  onMouseEnter={() => setSelectedBandIdx(band.bandIndex)}
                  className="flex-1 h-full flex flex-col justify-end items-center group focus:outline-none cursor-pointer"
                >
                  <span className="text-[10px] font-mono text-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity mb-0.5 tabular-nums font-bold">
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
          <div className="flex items-center justify-between gap-1.5 pt-2">
            {activePsdBands.map((band) => (
              <div
                key={band.bandIndex}
                className="flex-1 text-center text-[10px] font-mono text-slate-400 tabular-nums truncate"
              >
                {band.bandIndex % 2 === 1 ? band.label : ''}
              </div>
            ))}
          </div>

          {/* Inspected Band Telemetry Readout Bar */}
          {inspectedBand && (
            <div className="mt-3 pt-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
              <div className="flex items-center gap-2">
                <span className="font-sans font-bold text-slate-200">
                  {selectedBandIdx !== null ? 'Inspected Bar:' : 'Loudest Peak:'}
                </span>
                <span className="font-bold text-cyan-400">{inspectedBand.rangeLabel}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-bold border ${regimeColorClasses[inspectedBand.regime].bgBadge}`}>
                  {inspectedBand.regimeLabel}
                </span>
              </div>
              <div className="flex items-center gap-3 text-slate-300">
                <span>Power: <strong className="text-white">{inspectedBand.psdDbPerHz.toFixed(1)}</strong> dB/Hz</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>Share: <strong className="text-white">{inspectedBand.energySharePct.toFixed(1)}%</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* 4-Regime Aggregate Spectral Energy Share Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 text-xs">
          <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-lg px-3 py-2">
            <div className="text-[11px] font-bold text-emerald-800 whitespace-nowrap">Calm Hum (Green)</div>
            <div className="font-mono text-sm font-extrabold text-emerald-700 tabular-nums mt-0.5">
              {(signal.features.subBandLowRatio * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg px-3 py-2">
            <div className="text-[11px] font-bold text-amber-800 whitespace-nowrap">Pebbles (Gold)</div>
            <div className="font-mono text-sm font-extrabold text-amber-700 tabular-nums mt-0.5">
              {(signal.features.subBandMidRatio * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-sky-50/70 border border-sky-200/80 rounded-lg px-3 py-2">
            <div className="text-[11px] font-bold text-sky-800 whitespace-nowrap">Crack Spray (Blue)</div>
            <div className="font-mono text-sm font-extrabold text-sky-700 tabular-nums mt-0.5">
              {(signal.features.subBandHighRatio * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-rose-50/70 border border-rose-200/80 rounded-lg px-3 py-2">
            <div className="text-[11px] font-bold text-rose-800 whitespace-nowrap">Pop Bubbles (Red)</div>
            <div className="font-mono text-sm font-extrabold text-rose-700 tabular-nums mt-0.5">
              {(signal.features.subBandUltraRatio * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Spectrogram Waterfall Card */}
      <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <Waves className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Colorful Sound Rainbow (Spectrogram Waterfall)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Dark blue means quiet water · Bright blue and gold stripes show loud leak noises!
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-600 tabular-nums bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
            <span>Rate: <strong>{signal.sampleRate}</strong> Hz</span>
            <span aria-hidden="true" className="text-slate-300">|</span>
            <span>Slices: <strong>{signal.spectrogramFrames.length}</strong></span>
          </div>
        </div>
        <div className="relative rounded-lg overflow-hidden border border-slate-900 bg-slate-950 shadow-inner">
          <canvas
            ref={specCanvasRef}
            width={760}
            height={175}
            data-testid="spectrogram-canvas"
            className="w-full h-[175px] block"
          />
        </div>
      </div>

      {/* FFT Power Spectrum Card */}
      <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                <Radio className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Sound Pitch Map (Low Hums to High Squeaks)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Move your mouse across the wave to explore where the sound is tallest
            </p>
          </div>
          <div className="text-xs font-mono text-slate-700 tabular-nums bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
            {hoverFreqInfo ? (
              <span>
                Pitch: <strong className="text-sky-700">{hoverFreqInfo.freqHz} Hz</strong> / {hoverFreqInfo.magDb} dB
              </span>
            ) : (
              <span>
                Ceiling: <strong>{signal.features.spectralRolloffHz.toFixed(0)} Hz</strong>
              </span>
            )}
          </div>
        </div>
        <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shadow-2xs">
          <canvas
            ref={fftCanvasRef}
            width={760}
            height={165}
            data-testid="fft-canvas"
            onMouseMove={handleFftMouseMove}
            onMouseLeave={() => setHoverFreqInfo(null)}
            className="w-full h-[165px] block cursor-crosshair"
          />
        </div>
      </div>

      {/* Multi-Mode Acoustic Oscilloscope & D3 Frequency Spectrum Stage */}
      <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                  visualizerMode === 'spectrum'
                    ? 'bg-sky-100 text-sky-700'
                    : visualizerMode === 'dual_overlay'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-teal-100 text-teal-700'
                }`}
              >
                {visualizerMode === 'spectrum' ? (
                  <Radio className="w-3.5 h-3.5" />
                ) : visualizerMode === 'dual_overlay' ? (
                  <Layers className="w-3.5 h-3.5" />
                ) : (
                  <Activity className="w-3.5 h-3.5" />
                )}
              </div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                {visualizerMode === 'spectrum'
                  ? 'Real-Time Frequency Spectrum (D3 Characteristic Leak Finder)'
                  : visualizerMode === 'dual_overlay'
                  ? 'Dual Oscilloscope & D3 Frequency Spectrum Overlay'
                  : 'Water Wiggle Wave & Hydrophone Acoustic Pulse'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {visualizerMode === 'spectrum'
                ? 'Interactive D3 real-time FFT spectrum · Pinpoints characteristic leak signatures in Hz & dB'
                : visualizerMode === 'dual_overlay'
                ? 'Superimposed time-domain pressure wave & D3 spectral curve for instant acoustic correlation'
                : 'Shows how fast the underwater microphone shakes · Pulsing rings slow down as distance increases'}
            </p>
          </div>

          {/* Mode Switcher Segmented Pills */}
          <div className="flex items-center gap-1 p-0.5 bg-slate-100/90 rounded-lg border border-slate-200 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setVisualizerMode('waveform')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                visualizerMode === 'waveform'
                  ? 'bg-white text-teal-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Time Wave</span>
            </button>
            <button
              type="button"
              onClick={() => setVisualizerMode('spectrum')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                visualizerMode === 'spectrum'
                  ? 'bg-white text-sky-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>D3 Spectrum</span>
            </button>
            <button
              type="button"
              onClick={() => setVisualizerMode('dual_overlay')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                visualizerMode === 'dual_overlay'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Dual Overlay</span>
            </button>
          </div>
        </div>

        {/* Telemetry Ribbons based on active mode */}
        {visualizerMode === 'waveform' && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-3 py-1.5 bg-sky-50/70 border border-sky-100 rounded-lg text-xs">
            <div className="flex items-center gap-2 font-mono">
              <span className="flex items-center gap-1.5 font-bold text-sky-900">
                <CircleDot className="w-3.5 h-3.5 text-sky-600 animate-pulse" />
                <span>Mic: {distanceM.toFixed(1)}m</span>
              </span>
              <span aria-hidden="true" className="text-sky-300">·</span>
              <span className="text-slate-600">
                Pulse: <strong className="text-sky-800">{pulseTele.pulseRateBpm} BPM</strong> ({pulseTele.pulseSpeedHz} Hz)
              </span>
              <span aria-hidden="true" className="text-sky-300">·</span>
              <span className="text-slate-600">
                Loss: <strong className="text-sky-800">-{pulseTele.attenuationDb} dB</strong>
              </span>
            </div>

            <span className="text-[11px] font-sans font-semibold text-sky-700 bg-white/80 border border-sky-200/80 px-2 py-0.5 rounded-full">
              {distanceM <= 3
                ? '⚡ Rapid Near-Field Pulses'
                : distanceM <= 12
                ? '🌊 Moderate Propagation'
                : '🐢 Slow Attenuated Waves'}
            </span>
          </div>
        )}

        {(visualizerMode === 'spectrum' || visualizerMode === 'dual_overlay') && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-3 py-1.5 bg-indigo-50/70 border border-indigo-100 rounded-lg text-xs">
            <div className="flex items-center gap-2 font-mono">
              {hoverSpectrumInfo ? (
                <>
                  <span className="font-bold text-indigo-900">
                    {hoverSpectrumInfo.freqHz} Hz ({hoverSpectrumInfo.magDb} dB)
                  </span>
                  <span aria-hidden="true" className="text-indigo-300">·</span>
                  <span className="text-slate-700 font-sans font-semibold">
                    {hoverSpectrumInfo.bandName}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-slate-600">
                    Centroid: <strong className="text-indigo-900">{signal.features.spectralCentroidHz.toFixed(0)} Hz</strong>
                  </span>
                  <span aria-hidden="true" className="text-indigo-300">·</span>
                  <span className="text-slate-600">
                    High Freq Ratio: <strong className="text-indigo-900">{(signal.features.highFreqEnergyRatio * 100).toFixed(1)}%</strong>
                  </span>
                </>
              )}
            </div>

            <span className="text-[11px] font-sans font-semibold text-indigo-700 bg-white/90 border border-indigo-200/80 px-2 py-0.5 rounded-full">
              {signal.features.subBandHighRatio > 0.4
                ? '⚡ High Fissure Jet Spray Band (1.8–4.8 kHz)'
                : signal.features.subBandUltraRatio > 0.15
                ? '💥 Cavitation Micro-Implosions (>4.8 kHz)'
                : signal.features.subBandMidRatio > 0.25
                ? '⚠️ Piping Seepage Sand Band (0.4–1.8 kHz)'
                : '🟢 Normal Ambient Turbine Flow (<400 Hz)'}
            </span>
          </div>
        )}

        {/* 1. Time-Domain Waveform Only */}
        {visualizerMode === 'waveform' && (
          <>
            <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shadow-2xs">
              <canvas
                ref={waveCanvasRef}
                width={760}
                height={135}
                data-testid="waveform-canvas"
                data-distance-m={distanceM}
                data-pulse-bpm={pulseTele.pulseRateBpm}
                data-pulse-speed-hz={pulseTele.pulseSpeedHz}
                onMouseMove={handleWaveMouseMove}
                onMouseLeave={() => setHoverWaveInfo(null)}
                className="w-full h-[135px] block cursor-crosshair"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 font-mono px-1">
              <span>Pulsing rings around the signal represent acoustic wave arrival</span>
              <span className="text-sky-700 font-semibold">{pulseTele.periodMs}ms cycle (slows as distance increases)</span>
            </div>
          </>
        )}

        {/* 2. D3 Real-Time Frequency Spectrum Only */}
        {visualizerMode === 'spectrum' && (
          <D3FrequencySpectrum
            signal={signal}
            liveFrameIdx={liveFrameIdx}
            isPlaying={isPlaying}
            onHoverSpectrum={setHoverSpectrumInfo}
          />
        )}

        {/* 3. Dual Overlay (Superimposed Waveform Canvas + D3 Frequency Spectrum SVG) */}
        {visualizerMode === 'dual_overlay' && (
          <div className="space-y-2.5">
            <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950 shadow-inner h-[155px]">
              {/* Layer 1: Time-Domain Wave in Background with Soft Glow */}
              <canvas
                ref={waveCanvasRef}
                width={760}
                height={155}
                data-testid="waveform-canvas"
                data-distance-m={distanceM}
                data-pulse-bpm={pulseTele.pulseRateBpm}
                data-pulse-speed-hz={pulseTele.pulseSpeedHz}
                onMouseMove={handleWaveMouseMove}
                onMouseLeave={() => setHoverWaveInfo(null)}
                className="absolute inset-0 w-full h-[155px] block opacity-50 mix-blend-screen"
              />

              {/* Layer 2: D3 Frequency Spectrum SVG Overlaid on Top */}
              <div className="absolute inset-0 pointer-events-auto">
                <D3FrequencySpectrum
                  signal={signal}
                  liveFrameIdx={liveFrameIdx}
                  isPlaying={isPlaying}
                  isOverlay={true}
                  hideLegend={true}
                  onHoverSpectrum={setHoverSpectrumInfo}
                />
              </div>
            </div>

            {/* Characteristic Leak Bands Legend */}
            <CharacteristicBandsLegend
              activeBandFilter={null}
              onToggleFilter={() => {}}
            />

            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono px-1">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-500 inline-block"></span>
                <span>Background: Waveform (Pressure Pa)</span>
                <span className="text-slate-300">|</span>
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block"></span>
                <span>Foreground: D3 FFT Spectrum (dB/Hz)</span>
              </span>
              <span className="text-indigo-700 font-semibold">
                Characteristic Leak Bands Highlighted
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
