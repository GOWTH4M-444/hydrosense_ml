import React, { useState } from 'react';
import { Award, Brain, Cpu, Sparkles, Target } from 'lucide-react';
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
        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 uppercase tracking-wider font-semibold">
            <span>Practice Sounds</span>
            <Sparkles className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-extrabold text-slate-900 tabular-nums">
              {metrics.datasetSize}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5 font-bold">
              Clips
            </span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
            {samplesPerClass} of each sound type
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 uppercase tracking-wider font-semibold">
            <span>Smart Score (Accuracy)</span>
            <Target className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-1 flex items-baseline">
            <span
              data-testid="ml-accuracy-value"
              className="text-2xl font-mono font-extrabold text-emerald-600 tabular-nums"
            >
              {(metrics.overallAccuracy * 100).toFixed(2)}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5 font-bold">%</span>
          </div>
          <div className="text-xs font-mono text-emerald-600 mt-1 font-semibold">
            ● Tested 5 Times
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 uppercase tracking-wider font-semibold">
            <span>Teamwork Grade</span>
            <Award className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-extrabold text-slate-900 tabular-nums">
              {metrics.macroF1.toFixed(3)}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5 font-bold">F1</span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
            Prec: {(metrics.macroPrecision * 100).toFixed(0)}% · Rec: {(metrics.macroRecall * 100).toFixed(0)}%
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 uppercase tracking-wider font-semibold">
            <span>Leak Spotting Power</span>
            <Brain className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-extrabold text-slate-900 tabular-nums">
              {metrics.rocAuc.toFixed(3)}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5 font-bold">AUC</span>
          </div>
          <div className="text-xs font-mono text-slate-500 mt-1 font-medium">
            1.000 Is Perfect Score!
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 uppercase tracking-wider font-semibold">
            <span>Brain Helpers</span>
            <Cpu className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="mt-1 flex items-baseline">
            <span className="text-2xl font-mono font-extrabold text-slate-900 tabular-nums">
              {metrics.treesCount}
            </span>
            <span className="text-xs uppercase font-mono text-slate-400 ml-1.5 font-bold">
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
        <div className="lg:col-span-4 bg-white border border-slate-200/90 shadow-xs rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <Brain className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Teach the Computer with Practice Sounds
              </h2>
            </div>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              Pick how many practice sounds to make with <code className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">generator.py</code> and press the button to train the computer brain!
            </p>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <label htmlFor="samples-per-class-range" className="font-semibold text-slate-700">
                    Practice Sounds per Group
                  </label>
                  <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
                    {samplesPerClass} ({samplesPerClass * 4} total)
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
                  className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                />
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <label htmlFor="trees-count-range" className="font-semibold text-slate-700">
                    Number of Brain Helpers (Trees)
                  </label>
                  <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
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
                  className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                />
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <label htmlFor="noise-aug-range" className="font-semibold text-slate-700">
                    How Clean Is the Water Sound?
                  </label>
                  <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
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
                  className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200/90">
            <button
              type="button"
              onClick={handleRetrain}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-slate-900 to-indigo-950 hover:from-slate-800 hover:to-indigo-900 active:scale-[0.99] rounded-lg transition-all cursor-pointer whitespace-nowrap shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Teach Computer Now</span>
            </button>
          </div>
        </div>

        {/* Center: 4x4 Confusion Matrix */}
        <div className="lg:col-span-4 bg-white border border-slate-200/90 shadow-xs rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Target className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Scorecard: Did the Computer Guess Right?
            </h2>
          </div>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
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
                      className="p-2 text-center font-bold text-slate-700 border-b border-slate-200"
                    >
                      {name.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {metrics.confusionMatrix.map((row, rIdx) => (
                  <tr key={metrics.classNames[rIdx]}>
                    <td className="p-2 font-sans font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap">
                      {metrics.classNames[rIdx]}
                    </td>
                    {row.map((val, cIdx) => {
                      const isDiag = rIdx === cIdx;
                      const ratio = val / Math.max(1, samplesPerClass);
                      return (
                        <td
                          key={cIdx}
                          className={`p-2.5 text-center border border-slate-100 transition-colors ${
                            isDiag
                              ? 'bg-sky-600 text-white font-extrabold shadow-inner'
                              : val > 0
                              ? 'bg-amber-50 text-amber-900 font-semibold'
                              : 'bg-slate-50 text-slate-400'
                          }`}
                        >
                          <div>{val}</div>
                          <div
                            className={`text-[10px] ${
                              isDiag ? 'text-sky-100 font-bold' : 'text-slate-400'
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
        <div className="lg:col-span-4 bg-white border border-slate-200/90 shadow-xs rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Sound Sorting Map (Color Groups)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mb-3.5 leading-relaxed">
            Each dot is a sound! The computer groups matching colors together to tell leaks apart.
          </p>

          <div className="border border-slate-800 rounded-lg bg-slate-950 overflow-hidden shadow-inner">
            <svg viewBox="-4.5 -4.0 9.0 8.0" className="w-full h-[210px] block">
              {/* Zero axes */}
              <line x1="-4.5" y1="0" x2="4.5" y2="0" stroke="#334155" strokeWidth="0.04" />
              <line x1="0" y1="-4.0" x2="0" y2="4.0" stroke="#334155" strokeWidth="0.04" />
              <text x="2.1" y="-0.2" fill="#94A3B8" fontSize="0.34" fontFamily="JetBrains Mono">
                Pitch (PC1)
              </text>
              <text x="0.18" y="-3.4" fill="#94A3B8" fontSize="0.34" fontFamily="JetBrains Mono">
                Snap (PC2)
              </text>

              {metrics.pcaScatter.map((pt, idx) => (
                <circle
                  key={idx}
                  cx={pt.x}
                  cy={-pt.y}
                  r={0.16}
                  fill={classColorMap[pt.classId]}
                  fillOpacity={0.88}
                  stroke="#FFFFFF"
                  strokeWidth={0.03}
                />
              ))}
            </svg>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3.5 text-xs text-slate-700">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/70 rounded-md px-2 py-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shrink-0" />
              <span className="font-medium truncate">Calm Dam Hum</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/70 rounded-md px-2 py-1">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-600 inline-block shrink-0" />
              <span className="font-medium truncate">Fast Crack Spray</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/70 rounded-md px-2 py-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block shrink-0" />
              <span className="font-medium truncate">Muddy Trickle</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/70 rounded-md px-2 py-1">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block shrink-0" />
              <span className="font-medium truncate">Popping Bubbles</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
