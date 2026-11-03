import React, { useState } from 'react';
import {
  AcousticClassId,
  evaluateSyntheticMLDataset,
  MLTrainingMetrics,
} from '../utils/acousticEngine';

export const MlTrainingLabView: React.FC = () => {
  const [samplesPerClass, setSamplesPerClass] = useState<number>(60);
  const [treesCount, setTreesCount] = useState<number>(150);
  const [noiseAugmentationDb, setNoiseAugmentationDb] = useState<number>(16);
  const [seed, setSeed] = useState<number>(9001);

  const metrics: MLTrainingMetrics = evaluateSyntheticMLDataset(
    samplesPerClass,
    treesCount,
    noiseAugmentationDb,
    seed
  );

  const handleRetrain = () => {
    setSeed((prev) => prev + 17);
  };

  const classColorMap: Record<AcousticClassId, string> = {
    normal_ambient: '#10B981',
    hairline_fissure: '#0284C7',
    internal_piping: '#D97706',
    cavitation_burst: '#E11D48',
  };

  return (
    <div className="space-y-6">
      {/* Top KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">
            Practice Sounds
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {metrics.datasetSize}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
              Clips
            </span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
            {samplesPerClass} of each sound type
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">
            Smart Score (Accuracy)
          </div>
          <div className="mt-1 flex items-baseline">
            <span
              data-testid="ml-accuracy-value"
              className="text-2xl font-mono font-bold text-slate-900 tabular-nums"
            >
              {(metrics.overallAccuracy * 100).toFixed(2)}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">%</span>
          </div>
          <div className="text-xs font-mono text-emerald-600 mt-1">
            ● Tested 5 Times
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">
            Teamwork Grade (F1)
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {metrics.macroF1.toFixed(3)}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">F1</span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
            Careful: {(metrics.macroPrecision * 100).toFixed(1)}% · Found: {(metrics.macroRecall * 100).toFixed(1)}%
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">
            Leak Spotting Power
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {metrics.rocAuc.toFixed(3)}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">AUC</span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1">
            1.000 Is a Perfect Score!
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider">
            Brain Helpers
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {metrics.treesCount}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
              Trees
            </span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1">
            Voting Together as a Team
          </div>
        </div>
      </div>

      {/* Main Split: Hyperparameter Controls + Confusion Matrix + PCA Feature Space */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Training Hyperparameters */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              Teach the Computer with Practice Sounds
            </h2>
            <p className="text-xs text-slate-600 mb-5">
              Pick how many practice sounds to make with <code className="font-mono">generator.py</code> and press the button to train the computer brain!
            </p>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="samples-per-class-range" className="font-medium text-slate-700">
                    Practice Sounds per Group
                  </label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {samplesPerClass} clips ({samplesPerClass * 4} total)
                  </span>
                </div>
                <input
                  id="samples-per-class-range"
                  type="range"
                  min={25}
                  max={150}
                  step={5}
                  value={samplesPerClass}
                  onChange={(e) => setSamplesPerClass(parseInt(e.target.value, 10))}
                  className="w-full accent-sky-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="trees-count-range" className="font-medium text-slate-700">
                    Number of Brain Helpers (Trees)
                  </label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {treesCount} trees
                  </span>
                </div>
                <input
                  id="trees-count-range"
                  type="range"
                  min={20}
                  max={300}
                  step={10}
                  value={treesCount}
                  onChange={(e) => setTreesCount(parseInt(e.target.value, 10))}
                  className="w-full accent-sky-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label htmlFor="noise-aug-range" className="font-medium text-slate-700">
                    How Clean Is the Water Sound?
                  </label>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {noiseAugmentationDb} dB
                  </span>
                </div>
                <input
                  id="noise-aug-range"
                  type="range"
                  min={2}
                  max={28}
                  step={1}
                  value={noiseAugmentationDb}
                  onChange={(e) => setNoiseAugmentationDb(parseInt(e.target.value, 10))}
                  className="w-full accent-sky-600 cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handleRetrain}
              className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Teach Computer Now
            </button>
          </div>
        </div>

        {/* Center: 4x4 Confusion Matrix */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Scorecard: Did the Computer Guess Right?
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Bright blue boxes show when the computer guessed the exact right sound!
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="p-2 text-left text-slate-400 font-mono text-[11px]">
                    Real \ Guess
                  </th>
                  {metrics.classNames.map((name) => (
                    <th
                      key={name}
                      className="p-2 text-center font-medium text-slate-700 border-b border-slate-200"
                    >
                      {name.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {metrics.confusionMatrix.map((row, rIdx) => (
                  <tr key={metrics.classNames[rIdx]}>
                    <td className="p-2 font-sans font-medium text-slate-800 border-r border-slate-200 whitespace-nowrap">
                      {metrics.classNames[rIdx]}
                    </td>
                    {row.map((val, cIdx) => {
                      const isDiag = rIdx === cIdx;
                      const ratio = val / Math.max(1, samplesPerClass);
                      return (
                        <td
                          key={cIdx}
                          className={`p-2.5 text-center border border-slate-100 ${
                            isDiag
                              ? 'bg-sky-600 text-white font-bold'
                              : val > 0
                              ? 'bg-amber-50 text-amber-900 font-medium'
                              : 'bg-slate-50 text-slate-400'
                          }`}
                        >
                          <div>{val}</div>
                          <div
                            className={`text-[10px] ${
                              isDiag ? 'text-sky-100' : 'text-slate-400'
                            }`}
                          >
                            {(ratio * 100).toFixed(0)}%
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: 2D PCA Feature Space Projection */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Sound Sorting Map (Matching Color Groups)
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            Each dot is a sound! The computer groups matching colors together to tell leaks apart.
          </p>

          <div className="border border-slate-200 rounded bg-slate-50 overflow-hidden">
            <svg viewBox="-4.5 -4.0 9.0 8.0" className="w-full h-[210px] block">
              {/* Zero axes */}
              <line x1="-4.5" y1="0" x2="4.5" y2="0" stroke="#CBD5E1" strokeWidth="0.04" />
              <line x1="0" y1="-4.0" x2="0" y2="4.0" stroke="#CBD5E1" strokeWidth="0.04" />
              <text x="2.1" y="-0.2" fill="#64748B" fontSize="0.34" fontFamily="JetBrains Mono">
                Pitch (PC1)
              </text>
              <text x="0.18" y="-3.4" fill="#64748B" fontSize="0.34" fontFamily="JetBrains Mono">
                Snap (PC2)
              </text>

              {metrics.pcaScatter.map((pt, idx) => (
                <circle
                  key={idx}
                  cx={pt.x}
                  cy={-pt.y}
                  r={0.14}
                  fill={classColorMap[pt.classId]}
                  fillOpacity={0.82}
                  stroke="#FFFFFF"
                  strokeWidth={0.03}
                />
              ))}
            </svg>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-700">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
              <span>Calm Dam Hum</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-600 inline-block" />
              <span>Fast Crack Spray</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" />
              <span>Muddy Trickle</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-600 inline-block" />
              <span>Popping Bubbles</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
