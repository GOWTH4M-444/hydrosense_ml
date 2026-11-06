import React, { useEffect, useRef, useState } from 'react';
import { Waves } from 'lucide-react';
import { SynthesizedSignal } from '../utils/acousticEngine';

interface SpectrogramViewProps {
  signal: SynthesizedSignal;
  isPlaying: boolean;
  liveFrameIdx: number | null;
}

export const SpectrogramView: React.FC<SpectrogramViewProps> = ({
  signal,
  isPlaying,
  liveFrameIdx,
}) => {
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollOffsetRef = useRef<number>(0);
  const [hoverProbe, setHoverProbe] = useState<{
    freqKhz: string;
    timeSec: string;
    powerDb: string;
  } | null>(null);

  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number | null = null;
    let lastTick = performance.now();

    const drawSpectrogram = (now: number) => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const frames = signal.spectrogramFrames;
      const numTimeSlices = frames.length || 36;
      const numFreqBins = frames[0]?.length || 64;

      const dt = now - lastTick;
      if (dt > 55) {
        scrollOffsetRef.current =
          (scrollOffsetRef.current + (isPlaying ? 0.45 : 0.12)) % numTimeSlices;
        lastTick = now;
      }

      const cellW = width / numTimeSlices;
      const cellH = height / numFreqBins;
      const shift = Math.floor(scrollOffsetRef.current);

      for (let t = 0; t < numTimeSlices; t++) {
        const frameIdx = (t + shift) % numTimeSlices;
        const col = frames[frameIdx] || frames[0];
        for (let f = 0; f < numFreqBins; f++) {
          const db = col[f];
          const norm = Math.max(0, Math.min(1, (db + 85) / 80));

          let r = 8;
          let g = 16;
          let b = 36;
          if (norm < 0.35) {
            const k = norm / 0.35;
            r = Math.round(8 + k * 10);
            g = Math.round(16 + k * 66);
            b = Math.round(36 + k * 112);
          } else if (norm < 0.72) {
            const k = (norm - 0.35) / 0.37;
            r = Math.round(18 + k * 20);
            g = Math.round(82 + k * 118);
            b = Math.round(148 + k * 82);
          } else {
            const k = (norm - 0.72) / 0.28;
            r = Math.round(38 + k * 215);
            g = Math.round(200 - k * 12);
            b = Math.round(230 - k * 195);
          }

          ctx.fillStyle = `rgb(${r},${g},${b})`;
          const y = height - (f + 1) * cellH;
          ctx.fillRect(
            Math.floor(t * cellW),
            Math.floor(y),
            Math.ceil(cellW) + 1,
            Math.ceil(cellH) + 1
          );
        }
      }

      // Draw horizontal frequency gridlines (1kHz, 2kHz, 4kHz, 6kHz)
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
      ctx.lineWidth = 1;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(241, 245, 249, 0.88)';

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

      // Highlight Spectral Centroid horizontal band marker on the spectrogram
      const centroidY = height - (signal.features.spectralCentroidHz / maxFreq) * height;
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.78)';
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, centroidY);
      ctx.lineTo(width, centroidY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#FDE047';
      ctx.fillText(
        `Centroid ${signal.features.spectralCentroidHz.toFixed(0)} Hz`,
        width - 118,
        Math.max(12, centroidY - 4)
      );

      // Highlight active STFT frame slice when playing
      if (liveFrameIdx !== null) {
        const playheadX = (liveFrameIdx / numTimeSlices) * width;
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
      }

      animId = requestAnimationFrame(drawSpectrogram);
    };

    animId = requestAnimationFrame(drawSpectrogram);
    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [signal, isPlaying, liveFrameIdx]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const maxFreq = signal.sampleRate / 2;
    const freqHz = (1 - relY) * maxFreq;
    const timeSec = relX * signal.params.durationSec;

    const frames = signal.spectrogramFrames;
    const tIdx = Math.min(frames.length - 1, Math.floor(relX * frames.length));
    const fIdx = Math.min(
      (frames[0]?.length || 64) - 1,
      Math.floor((1 - relY) * (frames[0]?.length || 64))
    );
    const db = frames[tIdx]?.[fIdx] ?? -60;

    setHoverProbe({
      freqKhz: (freqHz / 1000).toFixed(2),
      timeSec: timeSec.toFixed(2),
      powerDb: db.toFixed(1),
    });
  };

  return (
    <div
      data-testid="spectrogram-panel"
      className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4 flex flex-col justify-between h-full w-full gap-3"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Waves className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Colorful Sound Rainbow (Spectrogram Waterfall)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Dark blue means quiet water · Bright blue and gold stripes show loud leak noises!
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-600 tabular-nums bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
          {hoverProbe ? (
            <span>
              <strong className="text-indigo-700">{hoverProbe.freqKhz} kHz</strong> @{' '}
              {hoverProbe.timeSec}s ({hoverProbe.powerDb} dB)
            </span>
          ) : (
            <>
              <span>
                Rate: <strong>{signal.sampleRate}</strong> Hz
              </span>
              <span aria-hidden="true" className="text-slate-300">
                |
              </span>
              <span>
                Slices: <strong>{signal.spectrogramFrames.length}</strong>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Scrolling Waterfall Canvas (flex-1 stretches vertically to eliminate dead whitespace) */}
      <div className="flex-1 flex flex-col gap-2.5 min-h-0">
        <div className="flex-1 relative rounded-lg overflow-hidden border border-slate-900 bg-slate-950 shadow-inner min-h-[210px]">
          <canvas
            ref={specCanvasRef}
            width={760}
            height={235}
            data-testid="spectrogram-canvas"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverProbe(null)}
            className="w-full h-full block cursor-crosshair"
          />
        </div>

        {/* Coupled 5-Metric STFT & ML Telemetry Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono tabular-nums">
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
              Kurtosis
            </span>
            <strong className="text-slate-900 font-bold">
              {signal.features.kurtosis.toFixed(2)}
            </strong>
          </div>
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-lg px-2.5 py-1.5">
            <span className="block text-[9.5px] font-sans font-semibold text-slate-400 uppercase">
              MFCC c1/c2
            </span>
            <strong className="text-slate-900 font-bold">
              {signal.features.mfcc[0]?.toFixed(1)}/{signal.features.mfcc[1]?.toFixed(1)}
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

      {/* Color Scale Legend Footer */}
      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <span className="font-sans font-medium text-slate-600">Intensity Ramp:</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400">-85 dB</span>
            <div className="w-28 h-2 rounded-full bg-gradient-to-r from-[#081024] via-[#125294] via-[#26C6DA] to-[#FACC15] border border-slate-300" />
            <span className="text-[10px] text-amber-600 font-bold">-5 dB (Leak Peak)</span>
          </div>
        </div>
        <span className="text-indigo-700 font-sans font-semibold">
          Hz vs Time Waterfall · Rolloff {signal.features.spectralRolloffHz.toFixed(0)} Hz
        </span>
      </div>
    </div>
  );
};
