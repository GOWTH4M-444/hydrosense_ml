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
  generateWhimsicalSoundName,
  updateSoundHistory,
  SoundHistoryItem,
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




