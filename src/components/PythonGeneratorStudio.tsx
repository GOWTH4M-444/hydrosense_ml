import React, { useState } from 'react';
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
    const blob = new Blob([wavBytes], { type: 'audio/wav' });
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
      <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Ready-to-Play Dam Sound Pack
              </h2>
              <p className="text-xs text-slate-600">
                We don't need real dam recordings! Make pretend underwater leak sounds right here, listen to them, or save them as <code className="font-mono">.wav</code> files.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerateNewBatch}
              className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Make 4 New Sounds
            </button>
          </div>

          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-2 font-medium">Sound File Name</th>
                  <th className="py-2 px-2 font-medium">Depth · Crack</th>
                  <th className="py-2 px-2 font-medium">Pitch</th>
                  <th className="py-2 px-2 font-medium">Computer Guess</th>
                  <th className="py-2 pl-2 font-medium text-right">Play or Save</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {batchSamples.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-2 font-medium text-slate-900 whitespace-nowrap">
                      {item.filename}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 whitespace-nowrap">
                      {item.headM}m · {item.orificeMm}mm
                    </td>
                    <td className="py-2.5 px-2 text-slate-700 whitespace-nowrap">
                      {item.centroidHz} Hz
                    </td>
                    <td className="py-2.5 px-2 font-sans whitespace-nowrap">
                      <span className="font-medium text-slate-900">
                        {CLASS_METADATA[item.predictedClass].shortLabel}
                      </span>{' '}
                      <span className="font-mono text-slate-500">
                        ({(item.confidence * 100).toFixed(0)}%)
                      </span>
                    </td>
                    <td className="py-2.5 pl-2 text-right font-sans whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => onLoadGeneratedSample(item.params)}
                        className="text-xs font-medium text-sky-700 hover:text-sky-900 underline cursor-pointer"
                      >
                        Listen
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadWav(item.params, item.filename)}
                        className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
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

        <div className="mt-6 pt-4 border-t border-slate-200 text-xs text-slate-600 space-y-1.5">
          <div className="font-semibold text-slate-900">
            How <code className="font-mono">generator.py</code> Makes Underwater Sounds:
          </div>
          <p>
            1. <strong>Fast Crack Spray</strong>: Deeper water pushes harder (v = C_d · √(2gH)), making a high-pitched whistle between 1.8 kHz and 4.6 kHz.
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
      <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Python Sound Maker Code (<code className="font-mono">generator.py</code>)
            </h2>
            <p className="text-xs text-slate-500">
              You can copy or save this Python program to build dam sounds on your own computer!
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyCode}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? 'Copied Code!' : 'Copy Code'}
            </button>
            <button
              type="button"
              onClick={handleDownloadPythonFile}
              className="px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Save generator.py
            </button>
          </div>
        </div>

        <pre
          data-testid="python-generator-code"
          className="flex-1 bg-slate-950 text-slate-100 p-4 rounded-lg text-[11px] leading-relaxed font-mono overflow-x-auto max-h-[460px] overflow-y-auto border border-slate-800"
        >
          <code>{pythonCode}</code>
        </pre>
      </div>
    </div>
  );
};
