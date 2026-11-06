import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CircleDot, Layers, Radio } from 'lucide-react';
import {
  SynthesizedSignal,
  calculateAcousticPulseState,
} from '../utils/acousticEngine';
import { D3FrequencySpectrum, CharacteristicBandsLegend } from './D3FrequencySpectrum';

interface SoundwaveViewProps {
  signal: SynthesizedSignal;
  isPlaying: boolean;
  liveFrameIdx: number | null;
}

export const SoundwaveView: React.FC<SoundwaveViewProps> = ({
  signal,
  isPlaying,
  liveFrameIdx,
}) => {
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  const [visualizerMode, setVisualizerMode] = useState<'waveform' | 'spectrum' | 'dual_overlay'>(
    'waveform'
  );
  const [hoverWaveInfo, setHoverWaveInfo] = useState<{ timeMs: number; ampPa: number } | null>(
    null
  );
  const [hoverSpectrumInfo, setHoverSpectrumInfo] = useState<{
    freqHz: number;
    magDb: number;
    bandName: string;
    leakRisk: string;
  } | null>(null);

  const distanceM = signal.params.sensorDistanceM;
  const pulseTele = useMemo(() => calculateAcousticPulseState(0, distanceM), [distanceM]);

  // Render Time-Domain Waveform with Distance-Dependent Pulsing Acoustic Wavefront Rings
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isMounted = true;

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
      const pulse = calculateAcousticPulseState(now, distanceM, 64, 3);

      // 3. Draw pulsing acoustic wavefront rings around the visualized signal
      pulse.wavefronts.forEach((ring) => {
        const rx = ring.radiusPx * 2.3;
        const ry = ring.radiusPx * 0.88;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(midX, midY, rx, ry, 0, 0, Math.PI * 2);

        const grad = ctx.createRadialGradient(midX, midY, 4, midX, midY, rx);
        grad.addColorStop(0, `rgba(14, 165, 233, ${ring.opacity * 0.14})`);
        grad.addColorStop(0.65, `rgba(14, 165, 233, ${ring.opacity * 0.05})`);
        grad.addColorStop(1, 'rgba(14, 165, 233, 0)');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = `rgba(2, 132, 199, ${ring.opacity})`;
        ctx.lineWidth = ring.lineWidth;
        if (distanceM > 20) {
          ctx.setLineDash([6, 3]);
        }
        ctx.stroke();
        ctx.restore();
      });

      // 4. Hydrophone Center Sensor Pin & Distance Readout
      ctx.save();
      const sensorGlow = ctx.createRadialGradient(midX, midY, 1, midX, midY, 14);
      sensorGlow.addColorStop(0, 'rgba(2, 132, 199, 0.45)');
      sensorGlow.addColorStop(1, 'rgba(2, 132, 199, 0)');
      ctx.fillStyle = sensorGlow;
      ctx.beginPath();
      ctx.arc(midX, midY, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0284C7';
      ctx.beginPath();
      ctx.arc(midX, midY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillStyle = '#0369A1';
      ctx.textAlign = 'center';
      ctx.fillText(`HYDROPHONE @ ${distanceM.toFixed(1)}m`, midX, 16);
      ctx.restore();

      // 5. Draw Time-Domain Waveform Signal across the canvas
      const samples = signal.samples;
      const viewCount = Math.min(samples.length, 1200);
      const phaseOffset = isPlaying
        ? Math.floor((now / 18) % Math.max(1, samples.length - viewCount - 1))
        : 0;

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
  }, [signal, isPlaying, distanceM, visualizerMode]);

  const handleWaveMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const viewCount = Math.min(signal.samples.length, 1200);
    const idx = Math.min(viewCount - 1, Math.floor(relX * viewCount));
    const timeMs = (idx / signal.sampleRate) * 1000;
    const ampPa = signal.samples[idx] * 120;
    setHoverWaveInfo({
      timeMs: Number(timeMs.toFixed(2)),
      ampPa: Number(ampPa.toFixed(2)),
    });
  };

  return (
    <div
      data-testid="soundwave-panel"
      className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4 flex flex-col justify-between h-full w-full gap-3"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          <p className="text-xs text-slate-500 mt-0.5">
            {visualizerMode === 'spectrum'
              ? 'Interactive D3 real-time FFT spectrum · Pinpoints characteristic leak signatures in Hz & dB'
              : visualizerMode === 'dual_overlay'
              ? 'Superimposed time-domain pressure wave & D3 spectral curve for instant acoustic correlation'
              : 'Shows how fast the underwater microphone shakes · Pulsing rings slow down as distance increases'}
          </p>
        </div>

        {/* Mode Switcher Segmented Controls */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-100/90 rounded-lg border border-slate-200 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setVisualizerMode('waveform')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer whitespace-nowrap ${
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
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer whitespace-nowrap ${
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
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer whitespace-nowrap ${
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

      {/* Main Content Stage (flex-1 stretches vertically to eliminate blank gaps) */}
      <div className="flex-1 flex flex-col justify-between gap-2.5 min-h-0">
        {/* Telemetry Ribbons based on active mode */}
        {visualizerMode === 'waveform' && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-sky-50/70 border border-sky-100 rounded-lg text-xs">
            <div className="flex items-center gap-2 font-mono">
              <span className="flex items-center gap-1.5 font-bold text-sky-900">
                <CircleDot className="w-3.5 h-3.5 text-sky-600" />
                <span>Mic: {distanceM.toFixed(1)}m</span>
              </span>
              <span aria-hidden="true" className="text-sky-300">
                ·
              </span>
              <span className="text-slate-600">
                Pulse: <strong className="text-sky-800">{pulseTele.pulseRateBpm} BPM</strong> (
                {pulseTele.pulseSpeedHz} Hz)
              </span>
              <span aria-hidden="true" className="text-sky-300">
                ·
              </span>
              <span className="text-slate-600">
                Loss: <strong className="text-sky-800">-{pulseTele.attenuationDb} dB</strong>
              </span>
            </div>

            <span className="text-[11px] font-sans font-semibold text-sky-700">
              {hoverWaveInfo
                ? `${hoverWaveInfo.timeMs} ms · ${hoverWaveInfo.ampPa} Pa`
                : distanceM <= 3
                ? '⚡ Rapid Near-Field Pulses'
                : distanceM <= 12
                ? '🌊 Moderate Propagation'
                : '🐢 Slow Attenuated Waves'}
            </span>
          </div>
        )}

        {(visualizerMode === 'spectrum' || visualizerMode === 'dual_overlay') && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-indigo-50/70 border border-indigo-100 rounded-lg text-xs">
            <div className="flex items-center gap-2 font-mono">
              {hoverSpectrumInfo ? (
                <>
                  <span className="font-bold text-indigo-900">
                    {hoverSpectrumInfo.freqHz} Hz ({hoverSpectrumInfo.magDb} dB)
                  </span>
                  <span aria-hidden="true" className="text-indigo-300">
                    ·
                  </span>
                  <span className="text-slate-700 font-sans font-semibold">
                    {hoverSpectrumInfo.bandName}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-slate-600">
                    Centroid:{' '}
                    <strong className="text-indigo-900">
                      {signal.features.spectralCentroidHz.toFixed(0)} Hz
                    </strong>
                  </span>
                  <span aria-hidden="true" className="text-indigo-300">
                    ·
                  </span>
                  <span className="text-slate-600">
                    High Freq Ratio:{' '}
                    <strong className="text-indigo-900">
                      {(signal.features.highFreqEnergyRatio * 100).toFixed(1)}%
                    </strong>
                  </span>
                </>
              )}
            </div>

            <span className="text-[11px] font-sans font-semibold text-indigo-700">
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
          <div className="flex-1 relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shadow-2xs min-h-[195px]">
            <canvas
              ref={waveCanvasRef}
              width={760}
              height={200}
              data-testid="waveform-canvas"
              data-distance-m={distanceM}
              data-pulse-bpm={pulseTele.pulseRateBpm}
              data-pulse-speed-hz={pulseTele.pulseSpeedHz}
              onMouseMove={handleWaveMouseMove}
              onMouseLeave={() => setHoverWaveInfo(null)}
              className="w-full h-full block cursor-crosshair"
            />
          </div>
        )}

        {/* 2. D3 Real-Time Frequency Spectrum Only */}
        {visualizerMode === 'spectrum' && (
          <div className="flex-1 flex flex-col justify-center">
            <D3FrequencySpectrum
              signal={signal}
              liveFrameIdx={liveFrameIdx}
              isPlaying={isPlaying}
              onHoverSpectrum={setHoverSpectrumInfo}
            />
          </div>
        )}

        {/* 3. Dual Overlay (Superimposed Waveform Canvas + D3 Frequency Spectrum SVG) */}
        {visualizerMode === 'dual_overlay' && (
          <div className="flex-1 flex flex-col justify-between gap-2">
            <div className="flex-1 relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950 shadow-inner min-h-[175px]">
              <canvas
                ref={waveCanvasRef}
                width={760}
                height={180}
                data-testid="waveform-canvas"
                data-distance-m={distanceM}
                data-pulse-bpm={pulseTele.pulseRateBpm}
                data-pulse-speed-hz={pulseTele.pulseSpeedHz}
                onMouseMove={handleWaveMouseMove}
                onMouseLeave={() => setHoverWaveInfo(null)}
                className="absolute inset-0 w-full h-full block opacity-50 mix-blend-screen"
              />
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

            <CharacteristicBandsLegend activeBandFilter={null} onToggleFilter={() => {}} />
          </div>
        )}

        {/* Coupled 5-Metric Time-Domain & ML Clues Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono tabular-nums">
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-lg px-2.5 py-1.5">
            <span className="block text-[9.5px] font-sans font-semibold text-slate-400 uppercase">
              Zero-Crossings
            </span>
            <strong className="text-slate-900 font-bold">
              {signal.features.zeroCrossingRate.toFixed(0)}/s
            </strong>
          </div>
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-lg px-2.5 py-1.5">
            <span className="block text-[9.5px] font-sans font-semibold text-slate-400 uppercase">
              Kurtosis Snap
            </span>
            <strong className="text-slate-900 font-bold">
              {signal.features.kurtosis.toFixed(2)}
            </strong>
          </div>
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-lg px-2.5 py-1.5">
            <span className="block text-[9.5px] font-sans font-semibold text-slate-400 uppercase">
              Centroid
            </span>
            <strong className="text-slate-900 font-bold">
              {signal.features.spectralCentroidHz.toFixed(0)} Hz
            </strong>
          </div>
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-lg px-2.5 py-1.5">
            <span className="block text-[9.5px] font-sans font-semibold text-slate-400 uppercase">
              Leak Risk %
            </span>
            <strong
              className={
                signal.inference.leakProbability > 0.6
                  ? 'text-rose-600 font-bold'
                  : signal.inference.leakProbability > 0.25
                  ? 'text-amber-600 font-bold'
                  : 'text-emerald-600 font-bold'
              }
            >
              {(signal.inference.leakProbability * 100).toFixed(1)}%
            </strong>
          </div>
          <div className="col-span-2 sm:col-span-1 bg-slate-50/90 border border-slate-200/80 rounded-lg px-2.5 py-1.5">
            <span className="block text-[9.5px] font-sans font-semibold text-slate-400 uppercase">
              Spill Speed
            </span>
            <strong className="text-sky-700 font-bold">
              {signal.inference.estimatedFlowRateLitersPerMin.toFixed(1)} L/m
            </strong>
          </div>
        </div>
      </div>

      {/* Bottom Footer */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <span>Pulsing rings around the signal represent acoustic wave arrival</span>
        <span className="text-sky-700 font-semibold">
          {pulseTele.periodMs}ms cycle (slows as distance increases)
        </span>
      </div>
    </div>
  );
};
