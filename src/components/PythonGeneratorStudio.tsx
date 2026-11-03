import React, { useState } from 'react';
import { Check, Code, Copy, Download, Headphones, Sparkles } from 'lucide-react';
import {
  AcousticClassId,
  buildPythonGeneratorScript,
  CLASS_METADATA,
  encodeWavFileBytes,
  GeneratorParams,
  synthesizeDamAcousticSignal,
} from '../utils/acousticEngine';

interface PythonGeneratorStudioProps {
  currentParams: GeneratorParams;
  onLoadGeneratedSample: (params: GeneratorParams) => void;
}

interface BatchGeneratedItem {
  id: string;
  filename: string;
  signatureClass: AcousticClassId;
  headM: number;
  orificeMm: number;
  snrDb: number;
  centroidHz: number;
  predictedClass: AcousticClassId;
  confidence: number;
  params: GeneratorParams;
}

export const PythonGeneratorStudio: React.FC<PythonGeneratorStudioProps> = ({
  currentParams,
  onLoadGeneratedSample,
}) => {
  const [copied, setCopied] = useState(false);
  const [batchSamples, setBatchSamples] = useState<BatchGeneratedItem[]>(() => {
    const initialSeeds: { cls: AcousticClassId; head: number; orifice: number; snr: number; seed: number }[] = [
      { cls: 'hairline_fissure', head: 118, orifice: 3.4, snr: 17, seed: 501 },
      { cls: 'internal_piping', head: 76, orifice: 13.0, snr: 13, seed: 502 },
      { cls: 'cavitation_burst', head: 140, orifice: 7.5, snr: 19, seed: 503 },
      { cls: 'normal_ambient', head: 88, orifice: 0.5, snr: 22, seed: 504 },
    ];

    return initialSeeds.map((item, idx) => {
      const p: GeneratorParams = {
        ...currentParams,
        signatureClass: item.cls,
        hydrostaticHeadM: item.head,
        orificeDiameterMm: item.orifice,
        turbidityNoiseSnrDb: item.snr,
        seed: item.seed,
      };
      const synth = synthesizeDamAcousticSignal(p);
      return {
        id: `WAV-${idx + 1}`,
        filename: `${item.cls}_${item.seed}.wav`,
        signatureClass: item.cls,
        headM: item.head,
        orificeMm: item.orifice,
        snrDb: item.snr,
        centroidHz: Math.round(synth.features.spectralCentroidHz),
        predictedClass: synth.inference.predictedClass,
        confidence: synth.inference.confidence,
        params: p,
      };
    });
  });

  const pythonCode = buildPythonGeneratorScript(currentParams);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(pythonCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadPythonFile = () => {
    const blob = new Blob([pythonCode], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generator.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadWav = (p: GeneratorParams, filename: string) => {
    const synth = synthesizeDamAcousticSignal(p);
    const wavBytes = encodeWavFileBytes(synth.samples, synth.sampleRate);
    const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateNewBatch = () => {
    const classes: AcousticClassId[] = [
      'hairline_fissure',
      'internal_piping',
      'cavitation_burst',
      'normal_ambient',
    ];
    const baseSeed = Math.floor(Math.random() * 8000) + 1000;
    const nextBatch: BatchGeneratedItem[] = classes.map((cls, idx) => {
      const seed = baseSeed + idx * 13;
      const head = 65 + ((seed * 7) % 85);
      const orifice = cls === 'normal_ambient' ? 0.5 : Number((2.0 + ((seed * 3) % 14)).toFixed(1));
      const snr = 12 + ((seed * 5) % 12);
      const p: GeneratorParams = {
        ...currentParams,
        signatureClass: cls,
        hydrostaticHeadM: head,
        orificeDiameterMm: orifice,
        turbidityNoiseSnrDb: snr,
        seed,
      };
      const synth = synthesizeDamAcousticSignal(p);
      return {
        id: `WAV-${seed}`,
        filename: `${cls}_${seed}.wav`,
        signatureClass: cls,
        headM: head,
        orificeMm: orifice,
        snrDb: snr,
        centroidHz: Math.round(synth.features.spectralCentroidHz),
        predictedClass: synth.inference.predictedClass,
        confidence: synth.inference.confidence,
        params: p,
      };
    });
    setBatchSamples(nextBatch);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: Synthetic WAV Batch Generator Table */}
      <div className="lg:col-span-6 bg-white border border-slate-200/90 shadow-xs rounded-xl p-5 flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                  <Headphones className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                  Ready-to-Play Dam Sound Pack
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                We don&apos;t need real dam recordings! Make pretend underwater leak sounds right here, listen to them, or save them as <code className="font-mono text-slate-850 bg-slate-100 px-1 py-0.5 rounded">.wav</code> files.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerateNewBatch}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 active:scale-95 rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Make 4 New Sounds</span>
            </button>
          </div>

          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2.5 pr-2">File Name</th>
                  <th className="py-2.5 px-2">Depth · Crack</th>
                  <th className="py-2.5 px-2">Pitch</th>
                  <th className="py-2.5 px-2">Computer Guess</th>
                  <th className="py-2.5 pl-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {batchSamples.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 pr-2 font-bold text-slate-900 whitespace-nowrap">
                      {item.filename}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 whitespace-nowrap">
                      {item.headM}m · {item.orificeMm}mm
                    </td>
                    <td className="py-2.5 px-2 text-slate-700 whitespace-nowrap">
                      {item.centroidHz} Hz
                    </td>
                    <td className="py-2.5 px-2 font-sans whitespace-nowrap">
                      <span className="font-bold text-slate-900">
                        {CLASS_METADATA[item.predictedClass].shortLabel}
                      </span>{' '}
                      <span className="font-mono text-slate-500 text-[11px]">
                        ({(item.confidence * 100).toFixed(0)}%)
                      </span>
                    </td>
                    <td className="py-2.5 pl-2 text-right font-sans whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => onLoadGeneratedSample(item.params)}
                        className="px-2 py-1 text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 rounded-md transition-colors cursor-pointer border border-sky-100"
                      >
                        Listen
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadWav(item.params, item.filename)}
                        className="px-2 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer border border-slate-200"
                      >
                        Save Sound File
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-200/90 text-xs text-slate-600 space-y-1.5 leading-relaxed bg-slate-50/60 p-3.5 rounded-lg border border-slate-200/60">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <Code className="w-3.5 h-3.5 text-indigo-600" />
            <span>How <code className="font-mono font-bold text-indigo-700">generator.py</code> Makes Underwater Sounds:</span>
          </div>
          <p>
            1. <strong>Fast Crack Spray</strong>: Deeper water pushes harder (v = C<sub>d</sub> · &radic;(2gH)), making a high-pitched whistle between 1.8 kHz and 4.6 kHz.
          </p>
          <p>
            2. <strong>Muddy Tunnel Trickle</strong>: Pretends tiny pebbles and sand are bumping together underground (450–1,650 Hz).
          </p>
          <p>
            3. <strong>Popping Water Bubbles</strong>: Makes super-fast, sharp popping snaps above 4.8 kHz!
          </p>
        </div>
      </div>

      {/* Right Column: Live Synced generator.py Source Code */}
      <div className="lg:col-span-6 bg-white border border-slate-200/90 shadow-xs rounded-xl p-5 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <Code className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Python Sound Maker Code (<code className="font-mono text-xs">generator.py</code>)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              You can copy or save this Python program to build dam sounds on your own computer!
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer border border-slate-200"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700 font-bold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownloadPythonFile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save generator.py</span>
            </button>
          </div>
        </div>

        <pre
          data-testid="python-generator-code"
          className="flex-1 bg-slate-950 text-slate-100 p-4 rounded-lg text-[11px] leading-relaxed font-mono overflow-x-auto max-h-[460px] overflow-y-auto border border-slate-800 shadow-inner"
        >
          <code>{pythonCode}</code>
        </pre>
      </div>
    </div>
  );
};
