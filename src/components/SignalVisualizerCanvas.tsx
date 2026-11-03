import React, { useEffect, useRef, useState } from 'react';
import { PsdBandBin, SynthesizedSignal } from '../utils/acousticEngine';

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
  const [selectedBandIdx, setSelectedBandIdx] = useState<number | null>(null);
  const [psdMetricMode, setPsdMetricMode] = useState<'db' | 'energy_pct'>('db');
  const [liveFrameIdx, setLiveFrameIdx] = useState<number | null>(null);

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

  // Render Time-Domain Waveform
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Center zero line
    const midY = height / 2;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Draw first 1200 samples (~75 ms zoom window) for crisp oscillation inspection
    const samples = signal.samples;
    const viewCount = Math.min(samples.length, 1200);
    ctx.beginPath();
    for (let i = 0; i < viewCount; i++) {
      const x = (i / (viewCount - 1)) * width;
      const y = midY - samples[i] * (midY * 0.86);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = isPlaying ? '#0D9488' : '#0F172A';
    ctx.lineWidth = 1.4;
    ctx.stroke();
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
    { bar: string; activeBar: string; text: string }
  > = {
    turbine: {
      bar: 'bg-emerald-600/85 hover:bg-emerald-600',
      activeBar: 'bg-emerald-600 ring-2 ring-slate-900',
      text: 'text-emerald-700',
    },
    piping: {
      bar: 'bg-amber-500/85 hover:bg-amber-500',
      activeBar: 'bg-amber-500 ring-2 ring-slate-900',
      text: 'text-amber-700',
    },
    fissure: {
      bar: 'bg-sky-600/85 hover:bg-sky-600',
      activeBar: 'bg-sky-600 ring-2 ring-slate-900',
      text: 'text-sky-700',
    },
    cavitation: {
      bar: 'bg-rose-600/85 hover:bg-rose-600',
      activeBar: 'bg-rose-600 ring-2 ring-slate-900',
      text: 'text-rose-700',
    },
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Real-Time Power Spectral Density (PSD) Bar Chart Card */}
      <div
        data-testid="psd-bar-chart-card"
        className="bg-white border border-slate-200 rounded-lg p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Live Sound Energy Bars (Power Spectral Density)
            </h2>
            <p className="text-xs text-slate-500">
              16 sound bars from low rumbles (left) to high squeaks (right) · Click any bar to see how loud it is!
            </p>
          </div>

          {/* Interactive Metric Scale Switcher */}
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md border border-slate-200 shrink-0">
            <button
              type="button"
              onClick={() => setPsdMetricMode('db')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
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
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
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
        <div className="relative bg-slate-50 border border-slate-200 rounded p-3 pt-4">
          <div
            data-testid="psd-bar-chart-bars"
            className="h-[136px] flex items-end justify-between gap-1.5 border-b border-slate-300 pb-1"
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
                  <span className="text-[10px] font-mono text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity mb-0.5 tabular-nums">
                    {psdMetricMode === 'db'
                      ? `${band.psdDbPerHz.toFixed(0)}`
                      : `${band.energySharePct.toFixed(0)}%`}
                  </span>
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-t-xs transition-all duration-150 ${
                      isSelected ? palette.activeBar : palette.bar
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* X-Axis Frequency Band Labels */}
          <div className="flex items-center justify-between gap-1.5 pt-1.5">
            {activePsdBands.map((band) => (
              <div
                key={band.bandIndex}
                className="flex-1 text-center text-[10px] font-mono text-slate-500 tabular-nums truncate"
              >
                {band.bandIndex % 2 === 1 ? band.label : ''}
              </div>
            ))}
          </div>

          {/* Inspected Band Telemetry Readout Bar */}
          {inspectedBand && (
            <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
              <div className="flex items-center gap-2">
                <span className="font-sans font-semibold text-slate-800">
                  {selectedBandIdx !== null ? 'Picked Sound Bar:' : 'Loudest Sound Bar:'}
                </span>
                <span className="font-semibold text-slate-900">{inspectedBand.rangeLabel}</span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span className={regimeColorClasses[inspectedBand.regime].text}>
                  {inspectedBand.regimeLabel}
                </span>
              </div>
              <div className="flex items-center gap-3 text-slate-700">
                <span>Power: {inspectedBand.psdDbPerHz.toFixed(1)} dB/Hz</span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span>Share: {inspectedBand.energySharePct.toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* 4-Regime Aggregate Spectral Energy Share Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[11px] text-slate-500 whitespace-nowrap">Green: Calm Hum</div>
            <div className="font-mono font-semibold text-emerald-700 tabular-nums mt-0.5">
              {(signal.features.subBandLowRatio * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[11px] text-slate-500 whitespace-nowrap">Gold: Pebbles</div>
            <div className="font-mono font-semibold text-amber-700 tabular-nums mt-0.5">
              {(signal.features.subBandMidRatio * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[11px] text-slate-500 whitespace-nowrap">Blue: Crack Spray</div>
            <div className="font-mono font-semibold text-sky-700 tabular-nums mt-0.5">
              {(signal.features.subBandHighRatio * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
            <div className="text-[11px] text-slate-500 whitespace-nowrap">Red: Pop Bubbles</div>
            <div className="font-mono font-semibold text-rose-700 tabular-nums mt-0.5">
              {(signal.features.subBandUltraRatio * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Spectrogram Waterfall Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Colorful Sound Rainbow (Spectrogram Waterfall)
            </h2>
            <p className="text-xs text-slate-500">
              Dark blue means quiet water · Bright blue and gold stripes show loud leak noises!
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-600 tabular-nums">
            <span>Speed: {signal.sampleRate} Hz</span>
            <span aria-hidden="true">·</span>
            <span>Slices: {signal.spectrogramFrames.length}</span>
          </div>
        </div>
        <div className="relative rounded overflow-hidden border border-slate-800 bg-slate-950">
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
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Sound Pitch Map (Low Hums to High Squeaks)
            </h2>
            <p className="text-xs text-slate-500">
              Move your mouse across the wave to explore where the sound is tallest
            </p>
          </div>
          <div className="text-xs font-mono text-slate-700 tabular-nums">
            {hoverFreqInfo ? (
              <span>
                Pitch: {hoverFreqInfo.freqHz} Hz / {hoverFreqInfo.magDb} dB
              </span>
            ) : (
              <span>
                Top Pitch Ceiling: {signal.features.spectralRolloffHz.toFixed(0)} Hz
              </span>
            )}
          </div>
        </div>
        <div className="relative rounded overflow-hidden border border-slate-200 bg-slate-50">
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

      {/* Time-Domain Oscilloscope Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Water Wiggle Wave (Microphone Vibration)
            </h2>
            <p className="text-xs text-slate-500">
              Shows how fast the underwater microphone shakes when water rushes by
            </p>
          </div>
          <div className="text-xs font-mono text-slate-700 tabular-nums">
            {hoverWaveInfo ? (
              <span>
                Time = {hoverWaveInfo.timeMs} ms · Push = {hoverWaveInfo.ampPa} Pa
              </span>
            ) : (
              <span>
                Shake Power: {(signal.features.rmsAmplitude * 120).toFixed(2)} Pa · Snap Score: {signal.features.kurtosis.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div className="relative rounded overflow-hidden border border-slate-200 bg-slate-50">
          <canvas
            ref={waveCanvasRef}
            width={760}
            height={120}
            data-testid="waveform-canvas"
            onMouseMove={handleWaveMouseMove}
            onMouseLeave={() => setHoverWaveInfo(null)}
            className="w-full h-[120px] block cursor-crosshair"
          />
        </div>
      </div>
    </div>
  );
};
