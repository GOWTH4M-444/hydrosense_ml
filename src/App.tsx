/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Compass,
  Download,
  Droplets,
  Headphones,
  History,
  Lightbulb,
  Play,
  Radio,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Sparkles,
  Square,
  Star,
  Trash2,
  Volume2,
  Waves,
} from 'lucide-react';
import {
  AcousticClassId,
  CLASS_METADATA,
  encodeWavFileBytes,
  generateWhimsicalSoundName,
  getSoundTipForPresetOrClass,
  GeneratorParams,
  PRESET_CONFIGS,
  SoundHistoryItem,
  synthesizeDamAcousticSignal,
  synthesizePopBlipEffect,
  synthesizeTabClickEffect,
  synthesizeWhooshEffect,
  updateSoundHistory,
  loadFavoritesFromStorage,
  saveFavoritesToStorage,
  toggleFavoriteItem,
  removeFavoriteItem,
  isSeedFavorited,
  calculateAcousticPulsePeriodMs,
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
  const [whooshEffectActive, setWhooshEffectActive] = useState<boolean>(false);
  const [soundTipVisible, setSoundTipVisible] = useState<boolean>(true);
  const [soundTipHighlight, setSoundTipHighlight] = useState<boolean>(false);
  const [soundHistory, setSoundHistory] = useState<SoundHistoryItem[]>(() =>
    updateSoundHistory([], PRESET_CONFIGS.fissure_monolith_14.params, 'fissure_monolith_14', 5)
  );
  const [favorites, setFavorites] = useState<SoundHistoryItem[]>(() =>
    loadFavoritesFromStorage()
  );
  const [historySidebarTab, setHistorySidebarTab] = useState<'recent' | 'favorites'>('recent');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const popTimeoutRef = useRef<number | null>(null);
  const whooshTimeoutRef = useRef<number | null>(null);
  const soundTipTimeoutRef = useRef<number | null>(null);

  const signal = useMemo(() => synthesizeDamAcousticSignal(params), [params]);
  const whimsicalSoundName = useMemo(
    () => generateWhimsicalSoundName(params.seed),
    [params.seed]
  );
  const activeSoundTip = useMemo(
    () => getSoundTipForPresetOrClass(activePresetKey, params.signatureClass),
    [activePresetKey, params.signatureClass]
  );
  const currentSoundItem: SoundHistoryItem = useMemo(
    () => ({
      seed: params.seed,
      whimsicalName: whimsicalSoundName,
      signatureClass: params.signatureClass,
      presetKey: activePresetKey,
      params: { ...params },
    }),
    [params, whimsicalSoundName, activePresetKey]
  );
  const isCurrentSoundFavorited = useMemo(
    () => isSeedFavorited(favorites, params.seed),
    [favorites, params.seed]
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

  const playUiSoundBuffer = (samples: Float32Array, gainValue = 0.38, delaySec = 0) => {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    try {
      const sfxRate = 16000;
      const sfxBuffer = ctx.createBuffer(1, samples.length, sfxRate);
      sfxBuffer.getChannelData(0).set(samples);

      const sfxSource = ctx.createBufferSource();
      sfxSource.buffer = sfxBuffer;

      const sfxGain = ctx.createGain();
      sfxGain.gain.value = gainValue;
      sfxSource.connect(sfxGain);
      sfxGain.connect(ctx.destination);
      sfxSource.start(ctx.currentTime + delaySec);
    } catch {
      // ignore if audio context blocked
    }
  };

  const playPopBlipSound = () => {
    playUiSoundBuffer(synthesizePopBlipEffect(16000), 0.42, 0);
  };

  const playTabClickSound = () => {
    playUiSoundBuffer(synthesizeTabClickEffect(16000), 0.34, 0);
  };

  const triggerHistoryWhoosh = (delaySec = 0) => {
    playUiSoundBuffer(synthesizeWhooshEffect(16000), 0.36, delaySec);
    setWhooshEffectActive(true);
    if (whooshTimeoutRef.current) {
      window.clearTimeout(whooshTimeoutRef.current);
    }
    whooshTimeoutRef.current = window.setTimeout(() => {
      setWhooshEffectActive(false);
    }, 900);
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
    const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dam_${params.signatureClass}_${params.seed}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSwitchTab = (nextSection: ActiveSection) => {
    playTabClickSound();
    setActiveSection(nextSection);
  };

  const triggerSoundTipPopup = () => {
    setSoundTipVisible(true);
    setSoundTipHighlight(true);
    if (soundTipTimeoutRef.current) {
      window.clearTimeout(soundTipTimeoutRef.current);
    }
    soundTipTimeoutRef.current = window.setTimeout(() => {
      setSoundTipHighlight(false);
    }, 1400);
  };

  const handleSelectPreset = (presetKey: string) => {
    stopAudioPlayback();
    const nextParams = { ...PRESET_CONFIGS[presetKey].params };
    setActivePresetKey(presetKey);
    setParams(nextParams);
    setSoundHistory((prev) => updateSoundHistory(prev, nextParams, presetKey, 5));
    triggerHistoryWhoosh(0);
    triggerSoundTipPopup();
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
    triggerHistoryWhoosh(0.06);
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
    triggerSoundTipPopup();
  };

  const handleToggleFavorite = (item: SoundHistoryItem) => {
    const { favorites: nextFavorites, isFavorite } = toggleFavoriteItem(favorites, item);
    setFavorites(nextFavorites);
    saveFavoritesToStorage(nextFavorites);
    if (isFavorite) {
      playPopBlipSound();
    } else {
      playTabClickSound();
    }
  };

  const handleRemoveFavorite = (e: React.MouseEvent, seed: number) => {
    e.stopPropagation();
    const nextFavorites = removeFavoriteItem(favorites, seed);
    setFavorites(nextFavorites);
    saveFavoritesToStorage(nextFavorites);
    playTabClickSound();
  };

  const updateParam = <K extends keyof GeneratorParams>(key: K, value: GeneratorParams[K]) => {
    stopAudioPlayback();
    setActivePresetKey('custom');
    setParams((prev) => ({
      ...prev,
      [key]: value,
    }));
    if (key === 'signatureClass') {
      triggerSoundTipPopup();
    }
  };

  const { inference, features } = signal;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/80 text-slate-900 font-sans selection:bg-sky-500 selection:text-white">
      {/* Top Bar Contract: 3 zones separated by gap-8 with modern glassmorphism */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-8 px-6 py-3 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-xs">
        <a
          href="#workbench"
          onClick={(e) => {
            e.preventDefault();
            handleSwitchTab('workbench');
          }}
          className="flex items-center gap-2.5 text-slate-900 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 group cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform">
            <Waves className="w-4 h-4" />
          </div>
          <div>
            <span className="text-base font-bold tracking-tight text-slate-900 block leading-tight">
              HydroSense ML
            </span>
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-400 block -mt-0.5">
              Acoustic Dam Detective
            </span>
          </div>
        </a>

        <nav
          aria-label="Primary Workspace Navigation"
          className="flex items-center gap-1 sm:gap-2 text-xs font-semibold text-slate-600 overflow-x-auto p-1 bg-slate-100/80 rounded-lg border border-slate-200/60"
        >
          <button
            type="button"
            onClick={() => handleSwitchTab('workbench')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'workbench'
                ? 'bg-white text-sky-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>Listen to Dam</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab('tdoa_array')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'tdoa_array'
                ? 'bg-white text-sky-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Find the Leak</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab('ml_lab')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'ml_lab'
                ? 'bg-white text-sky-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Teach Computer</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab('generator_py')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'generator_py'
                ? 'bg-white text-sky-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Sound Maker</span>
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleSynthesizeNewSeed}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 whitespace-nowrap shrink-0 cursor-pointer shadow-xs ${
              popEffectActive
                ? 'bg-sky-500 text-white scale-105 ring-2 ring-sky-300 ring-offset-1'
                : 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white active:scale-95 shadow-sky-600/20'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${popEffectActive ? 'animate-spin' : ''}`} />
            <span>Make New Sound</span>
          </button>
        </div>
      </header>

      {/* Modern High-Precision Telemetry Ribbon (Obsidian & Cyan Precision Lab Accent) */}
      <div className="bg-slate-900 text-slate-300 border-b border-slate-800 px-6 py-2 flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums">
        <div className="flex flex-wrap items-center gap-3 text-slate-300">
          <span className="font-bold text-sky-400 bg-sky-950/60 border border-sky-800/60 px-2 py-0.5 rounded text-[11px]">
            TEST #{1040 + synthesisCount}
          </span>
          <span className="font-sans font-bold text-white tracking-tight flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-sky-400" />
            &ldquo;{whimsicalSoundName}&rdquo;
          </span>
          {popEffectActive && (
            <span
              role="status"
              aria-live="polite"
              className="text-cyan-300 font-sans font-bold animate-pulse"
            >
              · ♪ Pop-Blip! New Sound Ready!
            </span>
          )}
          <span aria-hidden="true" className="text-slate-700">|</span>
          <span className="text-slate-400">DEPTH: <strong className="text-slate-200">{params.hydrostaticHeadM.toFixed(0)}m</strong></span>
          <span aria-hidden="true" className="text-slate-700">·</span>
          <span className="text-slate-400">CRACK: <strong className="text-slate-200">{params.orificeDiameterMm.toFixed(1)}mm</strong></span>
          <span aria-hidden="true" className="text-slate-700">·</span>
          <span className="text-slate-400">MIC: <strong className="text-slate-200">{params.sensorDistanceM.toFixed(1)}m</strong></span>
          <span aria-hidden="true" className="text-slate-700">·</span>
          <span className="text-slate-400">CLARITY: <strong className="text-slate-200">{params.turbidityNoiseSnrDb.toFixed(0)}dB</strong></span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-[11px] font-sans">STATUS:</span>
          {inference.severity === 'Critical' && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/70 border border-rose-800/70 text-rose-300 font-semibold text-xs">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>Uh-Oh! Big Leak ({inference.predictedLabel})</span>
            </span>
          )}
          {inference.severity === 'Drifting' && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/70 border border-amber-800/70 text-amber-300 font-semibold text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Heads Up! Trickle ({inference.predictedLabel})</span>
            </span>
          )}
          {inference.severity === 'Nominal' && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-800/70 text-emerald-300 font-semibold text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>All Safe & Sound ({inference.predictedLabel})</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        {activeSection === 'workbench' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (3 cols): Kid-Friendly Dam Sound Builder */}
            <aside className="lg:col-span-3 bg-white border border-slate-200/90 shadow-xs rounded-xl p-5 space-y-5">
              <div>
                <div className="flex items-center gap-2 text-slate-900">
                  <div className="w-6 h-6 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                    <Sliders className="w-3.5 h-3.5" />
                  </div>
                  <h1 className="text-sm font-bold tracking-tight">
                    Dam Sound Builder
                  </h1>
                </div>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Make pretend underwater dam sounds and see if our smart computer can spot a hidden leak!
                </p>

                {/* Whimsical Sound Seed Name Badge */}
                <div
                  aria-label="Current Dam Sound Name Badge"
                  className="mt-3 flex items-center justify-between gap-2 px-3 py-2.5 bg-gradient-to-r from-sky-50 to-indigo-50/60 border border-sky-200/80 rounded-lg shadow-2xs"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-sky-700">
                        Sound Nickname
                      </span>
                      <span className="block text-xs font-bold text-slate-900 truncate">
                        &ldquo;{whimsicalSoundName}&rdquo;
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(currentSoundItem)}
                      title={isCurrentSoundFavorited ? 'Remove from Favorites' : 'Save to Favorites'}
                      aria-label={isCurrentSoundFavorited ? 'Remove from Favorites' : 'Save to Favorites'}
                      className={`p-1.5 rounded-md border transition-all cursor-pointer ${
                        isCurrentSoundFavorited
                          ? 'bg-amber-100/90 border-amber-300 text-amber-600 hover:bg-amber-200 shadow-2xs'
                          : 'bg-white/90 border-sky-200/80 text-slate-400 hover:text-amber-500 hover:border-amber-300 hover:bg-amber-50'
                      }`}
                    >
                      <Star
                        className={`w-3.5 h-3.5 transition-transform active:scale-125 ${
                          isCurrentSoundFavorited ? 'fill-amber-500 text-amber-500' : ''
                        }`}
                      />
                    </button>
                    <span className="text-[11px] font-mono tabular-nums font-semibold text-sky-800 bg-white/90 px-2 py-0.5 border border-sky-200/70 rounded-md shrink-0 shadow-2xs">
                      #{params.seed}
                    </span>
                  </div>
                </div>
              </div>

              {/* Preset Selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="preset-select"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                  >
                    <span>Pick a Dam Story</span>
                  </label>
                  {!soundTipVisible && (
                    <button
                      type="button"
                      onClick={() => setSoundTipVisible(true)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:text-sky-900 cursor-pointer transition-colors"
                    >
                      <Lightbulb className="w-3 h-3 text-amber-500" />
                      <span>Sound Tip</span>
                    </button>
                  )}
                </div>
                <div className="relative">
                  <select
                    id="preset-select"
                    value={activePresetKey}
                    onChange={(e) => {
                      if (e.target.value !== 'custom') {
                        handleSelectPreset(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 text-xs font-medium bg-slate-50 hover:bg-slate-100/80 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-transparent transition-colors cursor-pointer appearance-none pr-8"
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
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500">
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  </div>
                </div>

                {/* Sound Tip Popup / Badge */}
                {soundTipVisible && (
                  <div
                    role="status"
                    aria-live="polite"
                    aria-label="Sound Tip Badge"
                    className={`mt-2.5 p-3 rounded-lg border transition-all ${
                      soundTipHighlight
                        ? 'bg-amber-50 border-amber-300 shadow-xs'
                        : 'bg-amber-50/70 border-amber-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                          Sound Tip · {activeSoundTip.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSoundTipVisible(false)}
                        className="text-[10px] font-semibold text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        Hide
                      </button>
                    </div>
                    <p className="text-xs font-medium text-slate-800 leading-snug">
                      {activeSoundTip.tip}
                    </p>
                  </div>
                )}
              </div>

              {/* Acoustic Regime Selector */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-2">
                  What Kind of Sound?
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'normal_ambient' as AcousticClassId, color: 'emerald', label: 'Calm River', sub: 'Dam Safe' },
                      { id: 'internal_piping' as AcousticClassId, color: 'amber', label: 'Sneaky Trickle', sub: 'Soil Washing' },
                      { id: 'hairline_fissure' as AcousticClassId, color: 'sky', label: 'High Jet Hiss', sub: 'Tiny Crack' },
                      { id: 'cavitation_burst' as AcousticClassId, color: 'rose', label: 'Popping Bubbles', sub: 'Water Hammer' },
                    ]
                  ).map((item) => {
                    const active = params.signatureClass === item.id;
                    const borderActive =
                      item.color === 'emerald'
                        ? 'border-emerald-500 bg-emerald-50/90 text-emerald-950 shadow-xs ring-1 ring-emerald-400/50'
                        : item.color === 'amber'
                        ? 'border-amber-500 bg-amber-50/90 text-amber-950 shadow-xs ring-1 ring-amber-400/50'
                        : item.color === 'sky'
                        ? 'border-sky-500 bg-sky-50/90 text-sky-950 shadow-xs ring-1 ring-sky-400/50'
                        : 'border-rose-500 bg-rose-50/90 text-rose-950 shadow-xs ring-1 ring-rose-400/50';

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => updateParam('signatureClass', item.id)}
                        className={`p-2.5 text-left rounded-lg border transition-all cursor-pointer ${
                          active
                            ? borderActive
                            : 'bg-slate-50/70 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="text-xs font-bold truncate">
                            {item.label}
                          </span>
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              item.color === 'emerald'
                                ? 'bg-emerald-500'
                                : item.color === 'amber'
                                ? 'bg-amber-500'
                                : item.color === 'sky'
                                ? 'bg-sky-500'
                                : 'bg-rose-500'
                            }`}
                          />
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {item.sub}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Physical Parameter Scrubbers */}
              <div className="space-y-4 pt-3 border-t border-slate-200/90">
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <label htmlFor="head-slider" className="flex items-center gap-1.5 text-slate-700 font-semibold">
                      <Droplets className="w-3.5 h-3.5 text-sky-600" />
                      <span>Water Depth (How Deep?)</span>
                    </label>
                    <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
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
                    className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <label htmlFor="orifice-slider" className="flex items-center gap-1.5 text-slate-700 font-semibold">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                      <span>Crack Size (How Wide?)</span>
                    </label>
                    <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
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
                    className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <label htmlFor="distance-slider" className="flex items-center gap-1.5 text-slate-700 font-semibold">
                      <Radio className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Microphone Distance (How Far?)</span>
                    </label>
                    <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
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
                    className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                  />
                  <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono mt-1">
                    <span>Pulse: {((1000 / calculateAcousticPulsePeriodMs(params.sensorDistanceM)) * 60).toFixed(0)} BPM</span>
                    <span className="text-sky-700 font-sans font-semibold">
                      {params.sensorDistanceM <= 3
                        ? '⚡ Fast pulse'
                        : params.sensorDistanceM <= 15
                        ? '🌊 Medium pulse'
                        : '🐢 Slow pulse'}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <label htmlFor="snr-slider" className="flex items-center gap-1.5 text-slate-700 font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      <span>Water Clarity (Less Mud Noise)</span>
                    </label>
                    <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
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
                    className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <label htmlFor="rpm-slider" className="flex items-center gap-1.5 text-slate-700 font-semibold">
                      <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Water Wheel Spin Speed</span>
                    </label>
                    <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 tabular-nums">
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
                    className="w-full accent-sky-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
                  />
                </div>
              </div>

              {/* Audition & Export Controls */}
              <div className="pt-3 border-t border-slate-200/90 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePlayAudio}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer shadow-xs ${
                      isPlaying
                        ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20 ring-2 ring-rose-400/50'
                        : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-600/20'
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Stop Noise</span>
                        {/* Live audio wave pulses */}
                        <span className="flex items-center gap-0.5 ml-1">
                          <span className="w-1 h-2.5 bg-white rounded-full animate-bounce" />
                          <span className="w-1 h-3.5 bg-white rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1 h-2 bg-white rounded-full animate-bounce [animation-delay:300ms]" />
                        </span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play Noise</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadActiveWav}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-600" />
                    <span>Save Sound</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleSwitchTab('generator_py')}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-sky-700 hover:text-sky-900 bg-sky-50 hover:bg-sky-100/80 border border-sky-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Open Sound Maker Studio</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              {/* Sound History & Favorites Section */}
              <div className="pt-3 border-t border-slate-200/90">
                {/* Segmented Tab Switcher */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
                    <button
                      type="button"
                      onClick={() => {
                        playTabClickSound();
                        setHistorySidebarTab('recent');
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                        historySidebarTab === 'recent'
                          ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/80'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <History className="w-3 h-3 text-slate-500" />
                      <span>Recent ({soundHistory.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playTabClickSound();
                        setHistorySidebarTab('favorites');
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                        historySidebarTab === 'favorites'
                          ? 'bg-white text-amber-950 shadow-2xs border border-amber-200/80'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Star
                        className={`w-3 h-3 ${
                          favorites.length > 0 ? 'fill-amber-500 text-amber-500' : 'text-slate-400'
                        }`}
                      />
                      <span>Favorites ({favorites.length})</span>
                    </button>
                  </div>

                  {whooshEffectActive && historySidebarTab === 'recent' && (
                    <span className="text-[10px] text-sky-600 font-sans font-bold animate-pulse">
                      ~ Updated!
                    </span>
                  )}
                </div>

                {/* Tab: Recent History */}
                {historySidebarTab === 'recent' && (
                  <div>
                    <p className="text-[11px] text-slate-500 mb-2">
                      Click any sound to jump back to it, or star it to save as a favorite!
                    </p>
                    <ul className="space-y-1.5" aria-label="Recent Dam Sound Seeds">
                      {soundHistory.map((item) => {
                        const isCurrent = item.seed === params.seed;
                        const isFav = isSeedFavorited(favorites, item.seed);
                        return (
                          <li key={item.seed} className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleJumpToHistorySeed(item)}
                              className={`flex-1 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer min-w-0 ${
                                isCurrent
                                  ? 'bg-sky-50/90 border-sky-300 text-slate-900 shadow-2xs ring-1 ring-sky-300/60'
                                  : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                              }`}
                            >
                              <div className="min-w-0">
                                <span className="block text-xs font-semibold truncate">
                                  &ldquo;{item.whimsicalName}&rdquo;
                                </span>
                                <span className="block text-[10px] text-slate-500 truncate">
                                  {CLASS_METADATA[item.signatureClass].shortLabel}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md border shrink-0 ${
                                  isCurrent
                                    ? 'bg-sky-600 text-white border-sky-600 font-bold'
                                    : 'bg-white text-slate-600 border-slate-200'
                                }`}
                              >
                                #{item.seed}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleFavorite(item)}
                              title={isFav ? 'Remove from Favorites' : 'Save to Favorites'}
                              aria-label={isFav ? `Unfavorite ${item.whimsicalName}` : `Favorite ${item.whimsicalName}`}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer shrink-0 ${
                                isFav
                                  ? 'bg-amber-50 border-amber-300 text-amber-500 hover:bg-amber-100'
                                  : 'bg-white border-slate-200 text-slate-400 hover:text-amber-500 hover:border-amber-200 hover:bg-amber-50/50'
                              }`}
                            >
                              <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-500 text-amber-500' : ''}`} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Tab: Favorites (Persisted in localStorage) */}
                {historySidebarTab === 'favorites' && (
                  <div>
                    {favorites.length === 0 ? (
                      <div className="text-center p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-lg">
                        <Star className="w-5 h-5 text-amber-400 mx-auto mb-1.5" />
                        <p className="text-xs font-bold text-amber-950 mb-0.5">
                          No Favorite Sounds Yet!
                        </p>
                        <p className="text-[11px] text-amber-800/80 leading-snug mb-2.5">
                          Click the star button next to any sound to keep it saved right here.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleToggleFavorite(currentSoundItem)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-md transition-colors shadow-2xs cursor-pointer"
                        >
                          <Star className="w-3 h-3 fill-current" />
                          <span>Save &ldquo;{whimsicalSoundName}&rdquo;</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 px-0.5 mb-1">
                          <span>Saved in browser</span>
                          <span className="font-mono">{favorites.length} saved</span>
                        </div>
                        <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5" aria-label="Favorite Dam Sounds">
                          {favorites.map((item) => {
                            const isCurrent = item.seed === params.seed;
                            return (
                              <li key={item.seed} className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleJumpToHistorySeed(item)}
                                  className={`flex-1 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer min-w-0 ${
                                    isCurrent
                                      ? 'bg-amber-50/90 border-amber-300 text-slate-900 shadow-2xs ring-1 ring-amber-300/60'
                                      : 'bg-white border-slate-200 text-slate-700 hover:bg-amber-50/40 hover:border-amber-200'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1">
                                      <Star className="w-3 h-3 fill-amber-500 text-amber-500 shrink-0" />
                                      <span className="text-xs font-bold text-slate-900 truncate">
                                        &ldquo;{item.whimsicalName}&rdquo;
                                      </span>
                                    </div>
                                    <span className="block text-[10px] text-slate-500 truncate ml-4">
                                      {CLASS_METADATA[item.signatureClass].shortLabel}
                                    </span>
                                  </div>
                                  <span
                                    className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md border shrink-0 ${
                                      isCurrent
                                        ? 'bg-amber-500 text-white border-amber-500 font-bold'
                                        : 'bg-slate-50 text-slate-600 border-slate-200'
                                    }`}
                                  >
                                    #{item.seed}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleRemoveFavorite(e, item.seed)}
                                  title={`Remove ${item.whimsicalName} from Favorites`}
                                  aria-label={`Remove ${item.whimsicalName} from Favorites`}
                                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-all cursor-pointer shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>

            {/* Center Column (5 cols): Multi-Canvas Signal Stage */}
            <section className="lg:col-span-5">
              <SignalVisualizerCanvas signal={signal} isPlaying={isPlaying} />
            </section>

            {/* Right Column (4 cols): ML Inference & Feature Attribution Panel */}
            <aside className="lg:col-span-4 space-y-4">
              {/* Primary ML Diagnosis Card */}
              <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5">
                <div className="flex items-center justify-between text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Smart Computer Guess</span>
                  </div>
                  <span className="font-mono text-slate-700 tabular-nums font-semibold bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    SURE: {(inference.confidence * 100).toFixed(1)}%
                  </span>
                </div>

                <div
                  data-testid="predicted-regime-heading"
                  className="text-lg font-extrabold text-slate-900 mt-1 tracking-tight"
                >
                  {inference.predictedLabel}
                </div>

                <div className="mt-1.5">
                  {inference.severity === 'Critical' && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>Uh-Oh! Big Water Leak Sound Found</span>
                    </div>
                  )}
                  {inference.severity === 'Drifting' && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Heads Up! Small Sneaky Trickle Found</span>
                    </div>
                  )}
                  {inference.severity === 'Nominal' && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Yay! Dam Sounds Safe & Strong</span>
                    </div>
                  )}
                </div>

                {/* Key Telemetry Pair with Visual Range Meters */}
                <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-200/90">
                  <div className="bg-slate-50/70 border border-slate-200/80 rounded-lg p-3">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Leak Danger Chance
                    </div>
                    <div className="mt-1 flex items-baseline">
                      <span
                        data-testid="leak-probability-readout"
                        className={`text-2xl font-mono font-extrabold tabular-nums ${
                          inference.leakProbability > 0.6
                            ? 'text-rose-600'
                            : inference.leakProbability > 0.25
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {(inference.leakProbability * 100).toFixed(1)}
                      </span>
                      <span className="text-xs uppercase font-mono text-slate-400 ml-1 font-semibold">%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
                      <div
                        className={`h-full transition-all duration-300 ${
                          inference.leakProbability > 0.6
                            ? 'bg-rose-500'
                            : inference.leakProbability > 0.25
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.max(3, inference.leakProbability * 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="bg-slate-50/70 border border-slate-200/80 rounded-lg p-3">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Water Spill Speed
                    </div>
                    <div className="mt-1 flex items-baseline">
                      <span className="text-2xl font-mono font-extrabold text-slate-900 tabular-nums">
                        {inference.estimatedFlowRateLitersPerMin.toFixed(1)}
                      </span>
                      <span className="text-xs font-mono text-slate-400 ml-1.5 font-semibold">
                        L/min
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full bg-sky-500 transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(3, (inference.estimatedFlowRateLitersPerMin / 450) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Class Probability Distribution */}
                <div className="mt-4 pt-4 border-t border-slate-200/90 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span>What the Computer Thinks It Hears</span>
                    <span className="text-[11px] font-mono text-slate-500">4 Categories</span>
                  </div>
                  {inference.predictions.map((pred) => {
                    const pct = (pred.probability * 100).toFixed(1);
                    return (
                      <div key={pred.classId} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold text-slate-700">{pred.label}</span>
                          <span className="font-mono font-bold text-slate-900 tabular-nums">
                            {pct}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                          <div
                            className={`h-full transition-all duration-200 ${
                              pred.classId === 'normal_ambient'
                                ? 'bg-emerald-500'
                                : pred.classId === 'internal_piping'
                                ? 'bg-amber-500'
                                : pred.classId === 'hairline_fissure'
                                ? 'bg-sky-500'
                                : 'bg-rose-500'
                            }`}
                            style={{ width: `${Math.max(2, pred.probability * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Engineer / Bot Recommendation Box */}
                <div className="mt-4 pt-3.5 border-t border-slate-200/90">
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                    <Bot className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-900 block mb-0.5">
                        What Engineers Should Do:
                      </span>
                      <span>{CLASS_METADATA[inference.predictedClass].recommendedAction}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature Attribution & Extracted DSP Vector Card */}
              <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-sm font-bold text-slate-900">
                    Sound Clues the Computer Uses
                  </h2>
                  <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded">
                    6 FEATURES
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-3.5">
                  Our machine learning brain measures these 6 clues from every sound wave
                </p>

                <div className="divide-y divide-slate-100 text-xs">
                  {inference.featureContributions.map((fc) => (
                    <div key={fc.featureName} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800">{fc.featureName}</div>
                        <div className="text-[11px] text-slate-500 truncate">{fc.description}</div>
                      </div>
                      <div className="text-right font-mono shrink-0 tabular-nums">
                        <span className="font-bold text-slate-900">{fc.valueFormatted}</span>
                        <span className="text-[11px] text-slate-400 ml-1">{fc.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* MFCC Cepstral Vector Strip */}
                <div className="mt-3.5 pt-3.5 border-t border-slate-200/90">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
                    <span>8 Secret Sound Fingerprint Numbers</span>
                    <span className="font-mono text-[10px] text-slate-400">MFCC 1–8</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 font-mono text-[11px] tabular-nums">
                    {features.mfcc.map((val, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-50/80 border border-slate-200/90 rounded-md px-2 py-1 flex justify-between shadow-2xs"
                      >
                        <span className="text-slate-400">c{idx + 1}</span>
                        <span className="text-slate-900 font-bold">{val.toFixed(1)}</span>
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
