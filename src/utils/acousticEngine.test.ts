import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESET_CONFIGS,
  synthesizeDamAcousticSignal,
  computeTDOALocalization,
  evaluateSyntheticMLDataset,
  encodeWavFileBytes,
  buildPythonGeneratorScript,
  synthesizePopBlipEffect,
  synthesizeTabClickEffect,
  synthesizeWhooshEffect,
  generateWhimsicalSoundName,
  getSoundTipForPresetOrClass,
  updateSoundHistory,
  SoundHistoryItem,
  FAVORITES_STORAGE_KEY,
  loadFavoritesFromStorage,
  saveFavoritesToStorage,
  toggleFavoriteItem,
  removeFavoriteItem,
  isSeedFavorited,
  calculateAcousticPulsePeriodMs,
  calculateAcousticAttenuation,
  calculateAcousticPulseState,
  getDam3DRegimeAnimationProfile,
  calculateDamBaseLeakParticleConfig,
  computeDamBaseParticleTransform,
  CRITICAL_ORIFICE_DEFORMATION_THRESHOLD_MM,
  calculateDamOrificeDeformationState,
  computeMonolithVertexDeformationOffset,
} from './acousticEngine';

test('synthesizeDamAcousticSignal accurately distinguishes High-Pressure Fissure Jetting from Normal Ambient', () => {
  const fissureResult = synthesizeDamAcousticSignal(PRESET_CONFIGS.fissure_monolith_14.params);
  const normalResult = synthesizeDamAcousticSignal(PRESET_CONFIGS.nominal_baseline.params);

  assert.equal(fissureResult.inference.predictedClass, 'hairline_fissure');
  assert.ok(
    fissureResult.features.spectralCentroidHz > normalResult.features.spectralCentroidHz,
    `Expected fissure spectral centroid (${fissureResult.features.spectralCentroidHz}) > normal (${normalResult.features.spectralCentroidHz})`
  );
  assert.ok(fissureResult.inference.leakProbability > 0.75);
  assert.equal(normalResult.inference.predictedClass, 'normal_ambient');
  assert.ok(normalResult.inference.leakProbability < 0.35);
});

test('synthesizeDamAcousticSignal accurately identifies Internal Piping and Cavitation Bursts', () => {
  const pipingResult = synthesizeDamAcousticSignal(PRESET_CONFIGS.foundation_piping_curtain.params);
  const cavitationResult = synthesizeDamAcousticSignal(PRESET_CONFIGS.conduit_cavitation_shock.params);

  assert.equal(pipingResult.inference.predictedClass, 'internal_piping');
  assert.equal(cavitationResult.inference.predictedClass, 'cavitation_burst');
  assert.ok(
    cavitationResult.features.kurtosis > normalKurtosisBaseline(),
    `Expected cavitation kurtosis (${cavitationResult.features.kurtosis}) to exceed baseline`
  );
});

function normalKurtosisBaseline(): number {
  const normalResult = synthesizeDamAcousticSignal(PRESET_CONFIGS.nominal_baseline.params);
  return normalResult.features.kurtosis;
}

test('computeTDOALocalization triangulates dam leak coordinates within 1.5m tolerance', () => {
  const result = computeTDOALocalization(24.5, 38.0, 0.02);
  assert.equal(result.readings.length, 4);
  assert.ok(
    result.localizationErrorMeters <= 1.5,
    `Expected TDOA localization error <= 1.5m, got ${result.localizationErrorMeters}m`
  );
});

test('evaluateSyntheticMLDataset computes valid confusion matrix and high accuracy', () => {
  const metrics = evaluateSyntheticMLDataset(40, 120, 18, 42);
  assert.equal(metrics.datasetSize, 160);
  assert.equal(metrics.confusionMatrix.length, 4);
  assert.ok(metrics.overallAccuracy > 0.82, `Expected accuracy > 0.82, got ${metrics.overallAccuracy}`);
  assert.ok(metrics.macroF1 > 0.82);
});

test('encodeWavFileBytes generates valid RIFF WAVE header and PCM payload', () => {
  const dummySamples = new Float32Array(1600);
  const wavBytes = encodeWavFileBytes(dummySamples, 16000);
  assert.equal(wavBytes.byteLength, 44 + 1600 * 2);
  const header = String.fromCharCode(wavBytes[0], wavBytes[1], wavBytes[2], wavBytes[3]);
  assert.equal(header, 'RIFF');
});

test('buildPythonGeneratorScript embeds physical parameters into standalone generator.py script', () => {
  const script = buildPythonGeneratorScript(PRESET_CONFIGS.fissure_monolith_14.params);
  assert.ok(script.includes('def synthesize_hydrophone_wave'));
  assert.ok(script.includes('115.0'));
});

test('computePsdFrequencyBands distributes spectral energy into regime-appropriate frequency bands', () => {
  const fissureSignal = synthesizeDamAcousticSignal(PRESET_CONFIGS.fissure_monolith_14.params);
  const cavitationSignal = synthesizeDamAcousticSignal(PRESET_CONFIGS.conduit_cavitation_shock.params);

  assert.equal(fissureSignal.psdBands.length, 16);
  const fissureBandEnergy = fissureSignal.psdBands
    .filter((b) => b.regime === 'fissure')
    .reduce((sum, b) => sum + b.energySharePct, 0);
  const cavitationBandEnergy = cavitationSignal.psdBands
    .filter((b) => b.regime === 'cavitation')
    .reduce((sum, b) => sum + b.energySharePct, 0);

  assert.ok(
    fissureBandEnergy > 50,
    `Expected fissure bands (1.8-4.8 kHz) to hold >50% energy for fissure preset, got ${fissureBandEnergy.toFixed(1)}%`
  );
  assert.ok(
    cavitationBandEnergy > 45,
    `Expected cavitation bands (>4.8 kHz) to hold >45% energy for cavitation preset, got ${cavitationBandEnergy.toFixed(1)}%`
  );
});

test('synthesizePopBlipEffect generates a crisp, non-clipping bubble pop + blip waveform', () => {
  const sfx = synthesizePopBlipEffect(16000);
  assert.equal(sfx.length, 3520);
  let maxAbs = 0;
  let earlyEnergy = 0;
  let tailEnergy = 0;
  for (let i = 0; i < sfx.length; i++) {
    const abs = Math.abs(sfx[i]);
    if (abs > maxAbs) maxAbs = abs;
    if (i < 1600) earlyEnergy += sfx[i] * sfx[i];
    if (i > 3000) tailEnergy += sfx[i] * sfx[i];
  }
  assert.ok(maxAbs > 0.25 && maxAbs <= 0.95, `Expected peak in (0.25, 0.95], got ${maxAbs}`);
  assert.ok(earlyEnergy > tailEnergy * 10, 'Expected pop+blip sound effect to decay cleanly at tail');
});

test('generateWhimsicalSoundName produces fun, unique names for dam sound seeds', () => {
  assert.equal(generateWhimsicalSoundName(1042), 'Bubbly Pipe');
  assert.equal(generateWhimsicalSoundName(1073), 'Whispering River');
  const thirdName = generateWhimsicalSoundName(1104);
  assert.ok(thirdName.includes(' '), `Expected two-word whimsical name, got '${thirdName}'`);
  assert.notEqual(generateWhimsicalSoundName(1042), thirdName);
});

test('updateSoundHistory keeps at most 5 recent sound seeds and deduplicates revisited seeds', () => {
  const baseParams = PRESET_CONFIGS.fissure_monolith_14.params;
  let history: SoundHistoryItem[] = [];
  const seeds = [1042, 1073, 1104, 1135, 1166, 1197];
  for (const seed of seeds) {
    history = updateSoundHistory(history, { ...baseParams, seed }, 'fissure_monolith_14', 5);
  }
  assert.equal(history.length, 5);
  assert.equal(history[0].seed, 1197);
  assert.equal(history[4].seed, 1073);

  // Revisiting seed 1104 should move it to the top without duplicating
  history = updateSoundHistory(history, { ...baseParams, seed: 1104 }, 'fissure_monolith_14', 5);
  assert.equal(history.length, 5);
  assert.equal(history[0].seed, 1104);
});

test('synthesizeTabClickEffect and synthesizeWhooshEffect generate valid UI sound waveforms', () => {
  const clickWave = synthesizeTabClickEffect(16000);
  const whooshWave = synthesizeWhooshEffect(16000);

  assert.equal(clickWave.length, 1040);
  assert.equal(whooshWave.length, 3840);

  const clickPeak = Math.max(...Array.from(clickWave, (v) => Math.abs(v)));
  const whooshPeak = Math.max(...Array.from(whooshWave, (v) => Math.abs(v)));

  assert.ok(clickPeak > 0.15 && clickPeak <= 0.9, `Expected clickPeak in (0.15, 0.9], got ${clickPeak}`);
  assert.ok(whooshPeak > 0.1 && whooshPeak <= 0.9, `Expected whooshPeak in (0.1, 0.9], got ${whooshPeak}`);
});

test('getSoundTipForPresetOrClass returns kid-friendly Sound Tip sentences for dam stories', () => {
  const story1Tip = getSoundTipForPresetOrClass('fissure_monolith_14', 'hairline_fissure');
  assert.ok(story1Tip.tip.includes('tiny fountain'));
  const story2Tip = getSoundTipForPresetOrClass('foundation_piping_curtain', 'internal_piping');
  assert.ok(story2Tip.tip.includes('pebbles'));
  const customTip = getSoundTipForPresetOrClass('custom', 'cavitation_burst');
  assert.ok(customTip.tip.includes('fizzy soda bubbles'));
});

test('favorites management handles toggling, persistence, and deduplication', () => {
  const sampleA: SoundHistoryItem = {
    seed: 1042,
    whimsicalName: 'Bubbly Pipe',
    signatureClass: 'internal_piping',
    presetKey: 'foundation_piping_curtain',
    params: { ...PRESET_CONFIGS.foundation_piping_curtain.params, seed: 1042 },
  };

  const sampleB: SoundHistoryItem = {
    seed: 1073,
    whimsicalName: 'Whispering River',
    signatureClass: 'normal_ambient',
    presetKey: 'nominal_baseline',
    params: { ...PRESET_CONFIGS.nominal_baseline.params, seed: 1073 },
  };

  let favorites: SoundHistoryItem[] = [];

  // 1. Initial toggle should add sampleA
  const res1 = toggleFavoriteItem(favorites, sampleA);
  assert.equal(res1.isFavorite, true);
  assert.equal(res1.favorites.length, 1);
  assert.equal(res1.favorites[0].seed, 1042);
  favorites = res1.favorites;

  assert.equal(isSeedFavorited(favorites, 1042), true);
  assert.equal(isSeedFavorited(favorites, 1073), false);

  // 2. Add second item sampleB
  const res2 = toggleFavoriteItem(favorites, sampleB);
  assert.equal(res2.isFavorite, true);
  assert.equal(res2.favorites.length, 2);
  assert.equal(res2.favorites[0].seed, 1073);
  favorites = res2.favorites;

  // 3. Toggling sampleA again should remove it
  const res3 = toggleFavoriteItem(favorites, sampleA);
  assert.equal(res3.isFavorite, false);
  assert.equal(res3.favorites.length, 1);
  assert.equal(res3.favorites[0].seed, 1073);
  favorites = res3.favorites;

  // 4. removeFavoriteItem removes by seed directly
  const removed = removeFavoriteItem(favorites, 1073);
  assert.equal(removed.length, 0);

  // 5. Test localStorage mock serialization and deserialization
  const mockStorageMap = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => mockStorageMap.get(key) ?? null,
    setItem: (key: string, val: string) => {
      mockStorageMap.set(key, val);
    },
  };

  const toSave = [sampleA, sampleB];
  const savedOk = saveFavoritesToStorage(toSave, mockStorage);
  assert.equal(savedOk, true);
  assert.ok(mockStorageMap.has(FAVORITES_STORAGE_KEY));

  const loaded = loadFavoritesFromStorage(mockStorage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].whimsicalName, 'Bubbly Pipe');
  assert.equal(loaded[1].seed, 1073);

  // 6. Test corrupt storage fallback
  mockStorageMap.set(FAVORITES_STORAGE_KEY, 'invalid json{{');
  const fallback = loadFavoritesFromStorage(mockStorage);
  assert.deepEqual(fallback, []);
});

test('calculateAcousticPulsePeriodMs slows down monotonically as microphone distance increases', () => {
  const periodNear = calculateAcousticPulsePeriodMs(1.0);
  const periodMid = calculateAcousticPulsePeriodMs(10.0);
  const periodFar = calculateAcousticPulsePeriodMs(25.0);
  const periodExtreme = calculateAcousticPulsePeriodMs(50.0);

  // Period must increase (so speed in Hz decreases) as distance increases
  assert.ok(periodNear < periodMid, `Expected ${periodNear} < ${periodMid}`);
  assert.ok(periodMid < periodFar, `Expected ${periodMid} < ${periodFar}`);
  assert.ok(periodFar < periodExtreme, `Expected ${periodFar} < ${periodExtreme}`);

  // Check pulse speed in Hz
  const speedNearHz = 1000 / periodNear;
  const speedFarHz = 1000 / periodFar;
  assert.ok(speedNearHz > speedFarHz, `Speed at 1m (${speedNearHz.toFixed(2)}Hz) must be faster than at 25m (${speedFarHz.toFixed(2)}Hz)`);
});

test('calculateAcousticAttenuation decreases factor and increases decibel loss with distance', () => {
  const attNear = calculateAcousticAttenuation(1.0);
  const attFar = calculateAcousticAttenuation(25.0);

  assert.equal(attNear.attenuationFactor, 1.0);
  assert.equal(attNear.attenuationDb, 0);
  assert.ok(attFar.attenuationFactor < attNear.attenuationFactor);
  assert.ok(attFar.attenuationDb > 20); // ~28 dB loss at 25m
});

test('calculateAcousticPulseState returns valid concentric wavefronts with attenuating opacity', () => {
  const stateNear = calculateAcousticPulseState(1200, 1.5, 60, 3);
  const stateFar = calculateAcousticPulseState(1200, 25.0, 60, 3);

  assert.equal(stateNear.wavefronts.length, 3);
  assert.equal(stateFar.wavefronts.length, 3);

  // Near pulse speed must be substantially faster than far pulse speed
  assert.ok(stateNear.pulseSpeedHz > stateFar.pulseSpeedHz);
  assert.ok(stateNear.pulseRateBpm > stateFar.pulseRateBpm);

  // Check wavefront properties
  for (const ring of stateNear.wavefronts) {
    assert.ok(ring.phase >= 0 && ring.phase <= 1.0);
    assert.ok(ring.radiusPx >= 6 && ring.radiusPx <= 60);
    assert.ok(ring.opacity > 0 && ring.opacity <= 1.0);
    assert.ok(ring.lineWidth >= 1.0);
  }

  // Near signal wavefronts must have stronger opacity (less acoustic attenuation)
  assert.ok(stateNear.wavefronts[0].opacity > stateFar.wavefronts[0].opacity);
});

test('getDam3DRegimeAnimationProfile maps each sound type to distinct 3D structural animations', () => {
  const fissureProfile = getDam3DRegimeAnimationProfile(PRESET_CONFIGS.fissure_monolith_14.params);
  const pipingProfile = getDam3DRegimeAnimationProfile(PRESET_CONFIGS.foundation_piping_curtain.params);
  const cavitationProfile = getDam3DRegimeAnimationProfile(PRESET_CONFIGS.conduit_cavitation_shock.params);
  const normalProfile = getDam3DRegimeAnimationProfile(PRESET_CONFIGS.nominal_baseline.params);

  // 1. Hairline Fissure: Critical danger with active crack width and high-pressure jet
  assert.equal(fissureProfile.regime, 'hairline_fissure');
  assert.equal(fissureProfile.isDanger, true);
  assert.equal(fissureProfile.severity, 'Critical');
  assert.ok(fissureProfile.crackWidthScale > 1.0, `Expected fissure crackWidthScale > 1.0, got ${fissureProfile.crackWidthScale}`);
  assert.ok(fissureProfile.crackJetVelocityRatio > 1.2);
  assert.equal(fissureProfile.recommendedCameraPreset, 'leak');

  // Larger orifice diameter should scale crack width higher
  const widerFissure = getDam3DRegimeAnimationProfile({
    ...PRESET_CONFIGS.fissure_monolith_14.params,
    orificeDiameterMm: 12.0,
  });
  assert.ok(widerFissure.crackWidthScale > fissureProfile.crackWidthScale);

  // 2. Internal Piping: Drifting warning with foundation sediment erosion
  assert.equal(pipingProfile.regime, 'internal_piping');
  assert.equal(pipingProfile.isDanger, true);
  assert.equal(pipingProfile.severity, 'Drifting');
  assert.ok(pipingProfile.pipingSedimentIntensity > 1.0);
  assert.equal(pipingProfile.recommendedCameraPreset, 'piping');

  // 3. Cavitation Burst: Critical danger with ultrasonic shockwave rate
  assert.equal(cavitationProfile.regime, 'cavitation_burst');
  assert.equal(cavitationProfile.isDanger, true);
  assert.equal(cavitationProfile.severity, 'Critical');
  assert.ok(cavitationProfile.cavitationShockRateHz > 4.0);
  assert.equal(cavitationProfile.recommendedCameraPreset, 'cavitation');

  // 4. Normal Ambient: Safe nominal state with zero crack or piping intensity
  assert.equal(normalProfile.regime, 'normal_ambient');
  assert.equal(normalProfile.isDanger, false);
  assert.equal(normalProfile.severity, 'Nominal');
  assert.equal(normalProfile.crackWidthScale, 0);
  assert.equal(normalProfile.pipingSedimentIntensity, 0);
  assert.equal(normalProfile.cavitationShockRateHz, 0);
  assert.equal(normalProfile.recommendedCameraPreset, 'overview');
});

test('calculateDamBaseLeakParticleConfig and computeDamBaseParticleTransform activate dam base bubbles/droplets on high-probability leaks', () => {
  const fissureSignal = synthesizeDamAcousticSignal(PRESET_CONFIGS.fissure_monolith_14.params);
  const normalSignal = synthesizeDamAcousticSignal(PRESET_CONFIGS.nominal_baseline.params);

  const highProbConfig = calculateDamBaseLeakParticleConfig(
    PRESET_CONFIGS.fissure_monolith_14.params,
    fissureSignal.inference.leakProbability
  );
  const lowProbConfig = calculateDamBaseLeakParticleConfig(
    PRESET_CONFIGS.nominal_baseline.params,
    normalSignal.inference.leakProbability
  );

  // High-probability leak (>= 0.50) activates the dam base particle emitter
  assert.equal(highProbConfig.isActive, true);
  assert.ok(highProbConfig.leakProbability > 0.75);
  assert.ok(
    highProbConfig.activeParticleCount >= 60 &&
      highProbConfig.activeParticleCount <= highProbConfig.maxParticleCount,
    `Expected activeParticleCount in [60, 140], got ${highProbConfig.activeParticleCount}`
  );
  assert.ok(highProbConfig.estimatedFlowRateLpm > 0);
  assert.equal(highProbConfig.baseEmitterZones.length, 3);

  // Low-probability leak (< 0.50) deactivates the dam base particle emitter
  assert.equal(lowProbConfig.isActive, false);
  assert.equal(lowProbConfig.activeParticleCount, 0);
  assert.equal(lowProbConfig.estimatedFlowRateLpm, 0);

  // Verify particle transform for both bubble (even index) and droplet (odd index)
  const bubbleTransform = computeDamBaseParticleTransform(0, 1.25, highProbConfig);
  const dropletTransform = computeDamBaseParticleTransform(1, 1.25, highProbConfig);
  const inactiveTransform = computeDamBaseParticleTransform(0, 1.25, lowProbConfig);

  assert.equal(bubbleTransform.visible, true);
  assert.equal(bubbleTransform.isDroplet, false);
  assert.ok(bubbleTransform.y >= -8.5 && bubbleTransform.y <= 12.0);
  assert.ok(bubbleTransform.z >= 14.0);
  assert.ok(bubbleTransform.scaleX > 0);

  assert.equal(dropletTransform.visible, true);
  assert.equal(dropletTransform.isDroplet, true);
  assert.ok(dropletTransform.scaleY > dropletTransform.scaleX, 'Droplets should be elongated vertically');

  assert.equal(inactiveTransform.visible, false);
  assert.equal(inactiveTransform.scaleX, 0);
});

test('calculateDamOrificeDeformationState and computeMonolithVertexDeformationOffset toggle crack texture and mesh deformation strictly when orificeDiameterMm > 15mm', () => {
  assert.equal(CRITICAL_ORIFICE_DEFORMATION_THRESHOLD_MM, 15.0);

  // 1. Below or equal to 15.0mm -> undeformed
  const stateSmall = calculateDamOrificeDeformationState(3.2);
  const stateExactThreshold = calculateDamOrificeDeformationState(15.0);

  assert.equal(stateSmall.isDeformed, false);
  assert.equal(stateSmall.vertexDisplacementAmplitude, 0);
  assert.equal(stateSmall.crackTextureOpacity, 0);
  assert.equal(stateSmall.spallingDebrisCount, 0);

  assert.equal(stateExactThreshold.isDeformed, false);
  assert.equal(stateExactThreshold.vertexDisplacementAmplitude, 0);
  assert.equal(stateExactThreshold.crackTextureOpacity, 0);

  const zeroOffset = computeMonolithVertexDeformationOffset(-2.8, 5.5, 9.0, stateExactThreshold);
  assert.deepEqual(zeroOffset, { dx: 0, dy: 0, dz: 0 });

  // 2. Exceeding 15.0mm -> deformed crack texture + vertex displacement active
  const stateBreach = calculateDamOrificeDeformationState(18.5);
  const stateExtreme = calculateDamOrificeDeformationState(24.0);

  assert.equal(stateBreach.isDeformed, true);
  assert.ok(stateBreach.normalizedSeverity > 0 && stateBreach.normalizedSeverity < 1);
  assert.ok(stateBreach.vertexDisplacementAmplitude > 0.65);
  assert.ok(stateBreach.crackTextureOpacity > 0.78);
  assert.ok(stateBreach.canyonFractureSpreadFactor > 1.35);
  assert.ok(stateBreach.spallingDebrisCount >= 14);

  assert.ok(
    stateExtreme.vertexDisplacementAmplitude > stateBreach.vertexDisplacementAmplitude,
    'Larger orifice > 15mm should produce stronger mesh deformation amplitude'
  );

  // Vertex near Block #14 fracture seam (x = -2.5, y = 5.5, z = 9.0) must displace outward (+dz) and split laterally (+dx)
  const rightFlankOffset = computeMonolithVertexDeformationOffset(-2.5, 5.5, 9.0, stateBreach);
  const leftFlankOffset = computeMonolithVertexDeformationOffset(-3.9, 5.5, 9.0, stateBreach);

  assert.ok(rightFlankOffset.dx > 0, `Expected right flank +dx, got ${rightFlankOffset.dx}`);
  assert.ok(leftFlankOffset.dx < 0, `Expected left flank -dx, got ${leftFlankOffset.dx}`);
  assert.ok(rightFlankOffset.dz > 0, `Expected upstream buckling +dz, got ${rightFlankOffset.dz}`);

  // Vertex far away on downstream face (z = -10) should remain untouched
  const farDownstreamOffset = computeMonolithVertexDeformationOffset(20.0, 5.5, -10.0, stateBreach);
  assert.deepEqual(farDownstreamOffset, { dx: 0, dy: 0, dz: 0 });
});



