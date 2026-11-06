import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Sparkles } from 'lucide-react';
import {
  GeneratorParams,
  InspectedAcousticTelemetry,
  PsdBandBin,
  SoundHistoryItem,
  SynthesizedSignal,
} from '../utils/acousticEngine';
import { AcousticSpaceView } from './AcousticSpaceView';
import { SpectrogramView } from './SpectrogramView';
import { SoundwaveView } from './SoundwaveView';
import { PowerSpectrumView } from './PowerSpectrumView';

interface SignalVisualizerCanvasProps {
  signal: SynthesizedSignal;
  isPlaying: boolean;
  recentHistory?: SoundHistoryItem[];
  onSelectPointParams?: (params: GeneratorParams) => void;
  onInspectTelemetry?: (telemetry: InspectedAcousticTelemetry | null) => void;
}

export const SignalVisualizerCanvas: React.FC<SignalVisualizerCanvasProps> = ({
  signal,
  isPlaying,
  recentHistory = [],
  onSelectPointParams,
  onInspectTelemetry,
}) => {
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
  const activePsdBands: PsdBandBin[] = useMemo(() => {
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

  return (
    <div data-testid="acoustic-4panel-dashboard" className="w-full flex flex-col gap-4">
      {/* 4-Panel Dashboard Section Header with Coupled Live ML Telemetry Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200/90 shadow-2xs rounded-xl px-4 py-3 w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-slate-900 tracking-tight">
                4-Panel Real-Time Acoustic Feature Workbench
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-[10px] font-mono font-bold text-sky-800">
                <Sparkles className="w-3 h-3 text-sky-600" />
                COUPLED ML METRICS
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Simultaneously inspect Acoustic Space, Spectrogram, Soundwave, and Power Spectrum · Interacting with points or bands syncs with Sound Clues
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
          <span>
            Seed: <strong className="text-slate-900">#{signal.params.seed}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300">|</span>
          <span>
            Centroid: <strong className="text-sky-700">{signal.features.spectralCentroidHz.toFixed(0)} Hz</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300">|</span>
          <span>
            Kurtosis: <strong className="text-slate-900">{signal.features.kurtosis.toFixed(2)}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300">|</span>
          <span>
            Risk: <strong className="text-rose-600">{(signal.inference.leakProbability * 100).toFixed(1)}%</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300">|</span>
          <span>
            Spill: <strong className="text-sky-700">{signal.inference.estimatedFlowRateLitersPerMin.toFixed(1)} L/m</strong>
          </span>
        </div>
      </div>

      {/* Responsive 2x2 4-Panel Acoustic Dashboard Grid with Equal Height Stretch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch w-full">
        {/* Panel 1: Acoustic Space (2D Embedding Map + Polaroid Preview) */}
        <AcousticSpaceView
          signal={signal}
          recentHistory={recentHistory}
          onSelectPointParams={onSelectPointParams}
          onInspectTelemetry={onInspectTelemetry}
        />

        {/* Panel 2: Spectrogram Waterfall (Scrolling Hz vs Time) */}
        <SpectrogramView
          signal={signal}
          isPlaying={isPlaying}
          liveFrameIdx={liveFrameIdx}
        />

        {/* Panel 3: Soundwave Time-Series (Waveform + Propagation Rings + D3 Spectrum Overlay) */}
        <SoundwaveView
          signal={signal}
          isPlaying={isPlaying}
          liveFrameIdx={liveFrameIdx}
        />

        {/* Panel 4: Power Spectrum Density (Smooth Area Spectrum + 16-Bar PSD + Category Share) */}
        <PowerSpectrumView
          signal={signal}
          activePsdBands={activePsdBands}
          onInspectTelemetry={onInspectTelemetry}
        />
      </div>
    </div>
  );
};
