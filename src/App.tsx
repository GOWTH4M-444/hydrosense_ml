/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  AcousticClassId,
  CLASS_METADATA,
  encodeWavFileBytes,
  generateWhimsicalSoundName,
  GeneratorParams,
  PRESET_CONFIGS,
  SoundHistoryItem,
  synthesizeDamAcousticSignal,
  synthesizePopBlipEffect,
  updateSoundHistory,
} from './utils/acousticEngine';
import { SignalVisualizerCanvas } from './components/SignalVisualizerCanvas';
import { DamArrayTdoaView } from './components/DamArrayTdoaView';
import { MlTrainingLabView } from './components/MlTrainingLabView';
import { PythonGeneratorStudio } from './components/PythonGeneratorStudio';

type ActiveSection = 'workbench' | 'tdoa_array' | 'ml_lab' | 'generator_py';

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('workbench');
  const [params, setParams] = useState<GeneratorParams>(
    PRESET_CONFIGS.fissure_monolith_14.params
  );
  const [activePresetKey, setActivePresetKey] = useState<string>('fissure_monolith_14');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [synthesisCount, setSynthesisCount] = useState<number>(1);
  const [popEffectActive, setPopEffectActive] = useState<boolean>(false);
  const [soundHistory, setSoundHistory] = useState<SoundHistoryItem[]>(() =>
    updateSoundHistory([], PRESET_CONFIGS.fissure_monolith_14.params, 'fissure_monolith_14', 5)
  );

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const popTimeoutRef = useRef<number | null>(null);

  const signal = useMemo(() => synthesizeDamAcousticSignal(params), [params]);
  const whimsicalSoundName = useMemo(
    () => generateWhimsicalSoundName(params.seed),
    [params.seed]
  );

  const getOrCreateAudioContext = (): AudioContext | null => {
    try {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextClass();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      return ctx;
    } catch {
      return null;
    }
  };

  const playPopBlipSound = () => {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    try {
      const sfxRate = 16000;
      const sfxSamples = synthesizePopBlipEffect(sfxRate);
      const sfxBuffer = ctx.createBuffer(1, sfxSamples.length, sfxRate);
      sfxBuffer.getChannelData(0).set(sfxSamples);

      const sfxSource = ctx.createBufferSource();
      sfxSource.buffer = sfxBuffer;

      const sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.42;
      sfxSource.connect(sfxGain);
      sfxGain.connect(ctx.destination);
      sfxSource.start();
    } catch {
      // ignore if audio context blocked
    }
  };

  const stopAudioPlayback = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {
        // ignore if already stopped
      }
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleTogglePlayAudio = () => {
    if (isPlaying) {
      stopAudioPlayback();
      return;
    }

    const ctx = getOrCreateAudioContext();
    if (!ctx) {
      setIsPlaying(false);
      return;
    }

    try {
      const audioBuffer = ctx.createBuffer(1, signal.samples.length, signal.sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      channelData.set(signal.samples);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 0.45;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.onended = () => {
        setIsPlaying(false);
        sourceNodeRef.current = null;
      };

      sourceNodeRef.current = source;
      setIsPlaying(true);
      source.start();
    } catch {
      setIsPlaying(false);
    }
  };

  const handleDownloadActiveWav = () => {
    const wavBytes = encodeWavFileBytes(signal.samples, signal.sampleRate);
    const blob = new Blob([wavBytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dam_${params.signatureClass}_${params.seed}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSelectPreset = (presetKey: string) => {
    stopAudioPlayback();
    const nextParams = { ...PRESET_CONFIGS[presetKey].params };
    setActivePresetKey(presetKey);
    setParams(nextParams);
    setSoundHistory((prev) => updateSoundHistory(prev, nextParams, presetKey, 5));
    setSynthesisCount((c) => c + 1);
  };

  const handleSynthesizeNewSeed = () => {
    stopAudioPlayback();
    playPopBlipSound();
    const nextParams: GeneratorParams = {
      ...params,
      seed: params.seed + 31,
    };
    setParams(nextParams);
    setSoundHistory((prev) => updateSoundHistory(prev, nextParams, activePresetKey, 5));
    setSynthesisCount((c) => c + 1);
    setPopEffectActive(true);
    if (popTimeoutRef.current) {
      window.clearTimeout(popTimeoutRef.current);
    }
    popTimeoutRef.current = window.setTimeout(() => {
      setPopEffectActive(false);
    }, 1100);

    if (activeSection !== 'workbench') {
      setActiveSection('workbench');
    }
  };

  const handleJumpToHistorySeed = (item: SoundHistoryItem) => {
    stopAudioPlayback();
    playPopBlipSound();
    setActivePresetKey(item.presetKey);
    setParams({ ...item.params });
  };

  const updateParam = <K extends keyof GeneratorParams>(key: K, value: GeneratorParams[K]) => {
    stopAudioPlayback();
    setActivePresetKey('custom');
    setParams((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const { inference, features } = signal;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        <a
          href="#workbench"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('workbench');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          HydroSense ML
        </a>

        <nav
          aria-label="Primary Workspace Navigation"
          className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => setActiveSection('workbench')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeSection === 'workbench'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Listen to Dam
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('tdoa_array')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeSection === 'tdoa_array'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Find the Leak
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('ml_lab')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeSection === 'ml_lab'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Teach Computer
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('generator_py')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeSection === 'generator_py'
                ? 'border-sky-600 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Sound Maker
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleSynthesizeNewSeed}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              popEffectActive
                ? 'bg-sky-600 scale-105 shadow-sm'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            Make New Sound
          </button>
        </div>
      </header>

      {/* Kid-Friendly Telemetry Sub-Ribbon */}
      <div className="bg-slate-100 border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-slate-600 font-mono tabular-nums">
          <span className="font-semibold text-slate-800">
            SOUND TEST #{1040 + synthesisCount}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-sans font-semibold text-sky-800">
            &ldquo;{whimsicalSoundName}&rdquo;
          </span>
          {popEffectActive && (
            <span
              role="status"
              aria-live="polite"
              className="text-sky-700 font-sans font-semibold"
            >
              · ♪ Pop-Blip! New Sound Ready!
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span>WATER DEPTH: {params.hydrostaticHeadM.toFixed(0)} m</span>
          <span aria-hidden="true">·</span>
          <span>CRACK SIZE: {params.orificeDiameterMm.toFixed(1)} mm</span>
          <span aria-hidden="true">·</span>
          <span>MIC DISTANCE: {params.sensorDistanceM.toFixed(1)} m</span>
          <span aria-hidden="true">·</span>
          <span>CLARITY: {params.turbidityNoiseSnrDb.toFixed(0)} dB</span>
        </div>

        <div className="flex items-center gap-4 font-mono tabular-nums">
          <span className="text-slate-600">
            DAM CHECKUP:{' '}
            {inference.severity === 'Critical' && (
              <strong className="text-rose-600">✖ Uh-Oh! Big Leak ({inference.predictedLabel})</strong>
            )}
            {inference.severity === 'Drifting' && (
              <strong className="text-amber-600">▲ Careful! Small Trickle ({inference.predictedLabel})</strong>
            )}
            {inference.severity === 'Nominal' && (
              <strong className="text-emerald-600">● All Safe! ({inference.predictedLabel})</strong>
            )}
          </span>
        </div>
      </div>

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        {activeSection === 'workbench' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (3 cols): Kid-Friendly Dam Sound Builder */}
            <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
              <div>
                <h1 className="text-base font-semibold text-slate-900">
                  Dam Sound Builder (<code className="font-mono text-xs">generator.py</code>)
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Make pretend underwater dam sounds and see if our smart computer can spot a hidden leak!
                </p>
                {/* Whimsical Sound Seed Name Badge */}
                <div
                  aria-label="Current Dam Sound Name Badge"
                  className="mt-3 flex items-center justify-between gap-2 px-3 py-2 bg-sky-50 border border-sky-200 rounded-md"
                >
                  <div className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-sky-700">
                      Sound Nickname
                    </span>
                    <span className="block text-xs font-bold text-slate-900 truncate">
                      {whimsicalSoundName}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums font-medium text-sky-800 bg-white px-2 py-0.5 border border-sky-200 rounded shrink-0">
                    Seed #{params.seed}
                  </span>
                </div>
              </div>

              {/* Preset Selector */}
              <div>
                <label
                  htmlFor="preset-select"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Pick a Dam Story
                </label>
                <select
                  id="preset-select"
                  value={activePresetKey}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      handleSelectPreset(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                >
                  {Object.entries(PRESET_CONFIGS).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.name}
                    </option>
                  ))}
                  {activePresetKey === 'custom' && (
                    <option value="custom">My Own Custom Dam Sound</option>
                  )}
                </select>
              </div>

              {/* Acoustic Regime Selector */}
              <div>
                <span className="block text-xs font-medium text-slate-700 mb-1.5">
                  What Kind of Sound?
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      'hairline_fissure',
                      'internal_piping',
                      'cavitation_burst',
                      'normal_ambient',
                    ] as AcousticClassId[]
                  ).map((clsId) => {
                    const active = params.signatureClass === clsId;
                    return (
                      <button
                        key={clsId}
                        type="button"
                        onClick={() => updateParam('signatureClass', clsId)}
                        className={`px-2.5 py-2 text-xs font-medium rounded-md border text-left transition-colors whitespace-nowrap truncate cursor-pointer ${
                          active
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {CLASS_METADATA[clsId].shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Physical Parameter Scrubbers */}
              <div className="space-y-3.5 pt-2 border-t border-slate-200">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="head-slider" className="text-slate-700 font-medium">
                      Water Depth (How Deep?)
                    </label>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {params.hydrostaticHeadM} m
                    </span>
                  </div>
                  <input
                    id="head-slider"
                    type="range"
                    min={15}
                    max={175}
                    step={1}
                    value={params.hydrostaticHeadM}
                    onChange={(e) => updateParam('hydrostaticHeadM', Number(e.target.value))}
                    className="w-full accent-sky-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="orifice-slider" className="text-slate-700 font-medium">
                      Crack Size (How Wide?)
                    </label>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {params.orificeDiameterMm.toFixed(1)} mm
                    </span>
                  </div>
                  <input
                    id="orifice-slider"
                    type="range"
                    min={0.5}
                    max={25.0}
                    step={0.5}
                    value={params.orificeDiameterMm}
                    onChange={(e) => updateParam('orificeDiameterMm', Number(e.target.value))}
                    className="w-full accent-sky-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="distance-slider" className="text-slate-700 font-medium">
                      Microphone Distance (How Far?)
                    </label>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {params.sensorDistanceM.toFixed(1)} m
                    </span>
                  </div>
                  <input
                    id="distance-slider"
                    type="range"
                    min={1.0}
                    max={50.0}
                    step={0.5}
                    value={params.sensorDistanceM}
                    onChange={(e) => updateParam('sensorDistanceM', Number(e.target.value))}
                    className="w-full accent-sky-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="snr-slider" className="text-slate-700 font-medium">
                      Water Clarity (Less Mud Noise)
                    </label>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {params.turbidityNoiseSnrDb} dB
                    </span>
                  </div>
                  <input
                    id="snr-slider"
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={params.turbidityNoiseSnrDb}
                    onChange={(e) => updateParam('turbidityNoiseSnrDb', Number(e.target.value))}
                    className="w-full accent-sky-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="rpm-slider" className="text-slate-700 font-medium">
                      Water Wheel Spin Speed
                    </label>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {params.turbineRpm} RPM
                    </span>
                  </div>
                  <input
                    id="rpm-slider"
                    type="range"
                    min={60}
                    max={240}
                    step={5}
                    value={params.turbineRpm}
                    onChange={(e) => updateParam('turbineRpm', Number(e.target.value))}
                    className="w-full accent-sky-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Audition & Export Controls */}
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePlayAudio}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      isPlaying
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'bg-sky-600 text-white hover:bg-sky-700'
                    }`}
                  >
                    {isPlaying ? 'Stop Noise' : 'Play Noise'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadActiveWav}
                    className="px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Save Sound File
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('generator_py')}
                  className="w-full px-3 py-2 text-xs font-medium text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Open Sound Maker Studio
                </button>
              </div>

              {/* Sound History (Last 5 Whimsical Names) */}
              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-1.5">
                  <h2 className="text-xs font-semibold text-slate-900">
                    Sound History
                  </h2>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    Last {soundHistory.length}/5
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">
                  Click any sound nickname to jump right back to it!
                </p>
                <ul className="space-y-1.5" aria-label="Recent Dam Sound Seeds">
                  {soundHistory.map((item) => {
                    const isCurrent = item.seed === params.seed;
                    return (
                      <li key={item.seed}>
                        <button
                          type="button"
                          onClick={() => handleJumpToHistorySeed(item)}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-left transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-sky-50 border-sky-300 text-slate-900'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="block text-xs font-semibold truncate">
                              {item.whimsicalName}
                            </span>
                            <span className="block text-[10px] text-slate-500 truncate">
                              {CLASS_METADATA[item.signatureClass].shortLabel}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded border shrink-0 ${
                              isCurrent
                                ? 'bg-sky-600 text-white border-sky-600 font-semibold'
                                : 'bg-white text-slate-600 border-slate-200'
                            }`}
                          >
                            #{item.seed}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>

            {/* Center Column (5 cols): Multi-Canvas Signal Stage */}
            <section className="lg:col-span-5">
              <SignalVisualizerCanvas signal={signal} isPlaying={isPlaying} />
            </section>

            {/* Right Column (4 cols): ML Inference & Feature Attribution Panel */}
            <aside className="lg:col-span-4 space-y-4">
              {/* Primary ML Diagnosis Card */}
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-center justify-between text-xs text-slate-500 uppercase tracking-wider mb-1">
                  <span>Smart Computer Guess</span>
                  <span className="font-mono text-slate-700 tabular-nums">
                    HOW SURE: {(inference.confidence * 100).toFixed(1)}%
                  </span>
                </div>

                <div
                  data-testid="predicted-regime-heading"
                  className="text-lg font-bold text-slate-900 mt-1"
                >
                  {inference.predictedLabel}
                </div>

                <div className="mt-1 text-xs font-mono">
                  {inference.severity === 'Critical' && (
                    <span className="text-rose-600 font-semibold">
                      ✖ Uh-Oh! Big Water Leak Sound Found
                    </span>
                  )}
                  {inference.severity === 'Drifting' && (
                    <span className="text-amber-600 font-semibold">
                      ▲ Heads Up! Small Sneaky Trickle Found
                    </span>
                  )}
                  {inference.severity === 'Nominal' && (
                    <span className="text-emerald-600 font-semibold">
                      ● Yay! Dam Sounds Safe & Strong
                    </span>
                  )}
                </div>

                {/* Key Telemetry Pair */}
                <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-200">
                  <div>
                    <div className="text-xs text-slate-500 uppercase tracking-wider">
                      Leak Danger Chance
                    </div>
                    <div className="mt-0.5 flex items-baseline">
                      <span
                        data-testid="leak-probability-readout"
                        className="text-2xl font-mono font-bold text-slate-900 tabular-nums"
                      >
                        {(inference.leakProbability * 100).toFixed(1)}
                      </span>
                      <span className="text-xs uppercase font-mono text-slate-400 ml-1">%</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500 uppercase tracking-wider">
                      Water Spill Speed
                    </div>
                    <div className="mt-0.5 flex items-baseline">
                      <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                        {inference.estimatedFlowRateLitersPerMin.toFixed(1)}
                      </span>
                      <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
                        L/min
                      </span>
                    </div>
                  </div>
                </div>

                {/* Class Probability Distribution */}
                <div className="mt-4 pt-4 border-t border-slate-200 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-800">
                    What the Computer Thinks It Hears
                  </div>
                  {inference.predictions.map((pred) => {
                    const pct = (pred.probability * 100).toFixed(1);
                    return (
                      <div key={pred.classId} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-slate-700">{pred.label}</span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {pct}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded overflow-hidden">
                          <div
                            className={`h-full transition-all duration-150 ${
                              pred.classId === 'normal_ambient'
                                ? 'bg-emerald-600'
                                : pred.classId === 'internal_piping'
                                ? 'bg-amber-500'
                                : 'bg-sky-600'
                            }`}
                            style={{ width: `${Math.max(2, pred.probability * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200 text-xs text-slate-600">
                  <span className="font-semibold text-slate-900">What Engineers Should Do: </span>
                  {CLASS_METADATA[inference.predictedClass].recommendedAction}
                </div>
              </div>

              {/* Feature Attribution & Extracted DSP Vector Card */}
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-1">
                  Sound Clues the Computer Uses
                </h2>
                <p className="text-xs text-slate-500 mb-3">
                  Our machine learning brain measures these 6 clues from every sound wave
                </p>

                <div className="divide-y divide-slate-100 text-xs">
                  {inference.featureContributions.map((fc) => (
                    <div key={fc.featureName} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-800">{fc.featureName}</div>
                        <div className="text-[11px] text-slate-500">{fc.description}</div>
                      </div>
                      <div className="text-right font-mono shrink-0 tabular-nums">
                        <span className="font-semibold text-slate-900">{fc.valueFormatted}</span>
                        <span className="text-[11px] text-slate-400 ml-1">{fc.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* MFCC Cepstral Vector Strip */}
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <div className="text-xs font-medium text-slate-700 mb-1.5">
                    8 Secret Sound Fingerprint Numbers (MFCC 1–8)
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 font-mono text-[11px] tabular-nums">
                    {features.mfcc.map((val, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-50 border border-slate-200 rounded px-2 py-1 flex justify-between"
                      >
                        <span className="text-slate-400">c{idx + 1}</span>
                        <span className="text-slate-800 font-medium">{val.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {activeSection === 'tdoa_array' && (
          <DamArrayTdoaView
            onSelectHydrophoneZone={(distanceMeters, headMeters) => {
              updateParam('sensorDistanceM', Number(distanceMeters.toFixed(1)));
              updateParam('hydrostaticHeadM', headMeters);
              setActiveSection('workbench');
            }}
          />
        )}

        {activeSection === 'ml_lab' && <MlTrainingLabView />}

        {activeSection === 'generator_py' && (
          <PythonGeneratorStudio
            currentParams={params}
            onLoadGeneratedSample={(newParams) => {
              stopAudioPlayback();
              setParams(newParams);
              setActivePresetKey('custom');
              setActiveSection('workbench');
            }}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <div>
          HydroSense ML · Kid-Friendly Dam Sound Detective & Machine Learning Explorer
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setActiveSection('generator_py')}
            className="hover:text-slate-900 underline cursor-pointer"
          >
            Open Sound Maker
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={handleDownloadActiveWav}
            className="hover:text-slate-900 underline cursor-pointer"
          >
            Save Sound File
          </button>
        </div>
      </footer>
    </div>
  );
}
