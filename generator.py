#!/usr/bin/env python3
"""
generator.py — Standalone Synthetic Hydro-Acoustic Dam Leak Audio Generator & ML Feature Pipeline
Generates physically modeled dam hydrophone audio (.wav) across 4 structural regimes:
  1. normal_ambient    : Baseline Francis turbine harmonics (50 - 300 Hz) & reservoir wave lap
  2. hairline_fissure  : High-pressure turbulent orifice jetting (1.8 kHz - 4.6 kHz)
  3. internal_piping   : Sub-surface embankment/grout curtain soil suffosion (450 Hz - 1.65 kHz)
  4. cavitation_burst  : Impulsive vapor bubble micro-implosions (4.5 kHz - 7.6 kHz)
"""

import os
import math
import wave
import argparse
import numpy as np

CLASSES = [
    "normal_ambient",
    "hairline_fissure",
    "internal_piping",
    "cavitation_burst",
]


def synthesize_hydrophone_wave(
    signature_class: str = "hairline_fissure",
    head_m: float = 115.0,
    orifice_mm: float = 3.2,
    distance_m: float = 8.5,
    attenuation_db: float = 0.22,
    snr_db: float = 16.0,
    turbine_rpm: float = 150.0,
    duration_sec: float = 1.5,
    sample_rate: int = 16000,
    seed: int = 1042,
) -> np.ndarray:
    """Synthesizes a 1D float32 hydro-acoustic signal for a concrete or embankment dam."""
    rng = np.random.default_rng(seed)
    n_samples = int(duration_sec * sample_rate)
    t = np.arange(n_samples, dtype=np.float64) / sample_rate

    jet_velocity = 0.62 * math.sqrt(2.0 * 9.80665 * max(5.0, head_m))
    dist_gain = 1.0 / (1.0 + 0.08 * distance_m)
    hf_damping = math.exp(-0.015 * attenuation_db * distance_m)

    f_turb = (turbine_rpm / 60.0) * 12.0
    baseline = (
        0.22 * np.sin(2.0 * np.pi * f_turb * t)
        + 0.11 * np.sin(2.0 * np.pi * (2.0 * f_turb) * t + 0.4)
        + 0.07 * np.sin(2.0 * np.pi * 50.0 * t)
    )

    white = rng.standard_normal(n_samples)
    anomaly = np.zeros(n_samples, dtype=np.float64)

    if signature_class == "normal_ambient":
        anomaly = np.convolve(white, np.ones(16) / 16.0, mode="same") * 0.12
    elif signature_class == "hairline_fissure":
        f_jet = min(4400.0, max(1950.0, 2100.0 + jet_velocity * 45.0 - orifice_mm * 32.0))
        mod = 1.0 + 0.25 * np.sin(2.0 * np.pi * 19.0 * t) + 0.15 * white
        anomaly = (
            0.48 * np.sin(2.0 * np.pi * f_jet * t + white * 0.45)
            + 0.34 * np.sin(2.0 * np.pi * (f_jet * 1.42) * t + white * 0.65)
        ) * mod * hf_damping
    elif signature_class == "internal_piping":
        f_pipe1 = 680.0 + head_m * 2.2
        f_pipe2 = 1180.0 + orifice_mm * 14.0
        grain_impacts = (rng.random(n_samples) > 0.965).astype(np.float64) * white * 0.65
        anomaly = (
            0.42 * np.sin(2.0 * np.pi * f_pipe1 * t + white * 0.5)
            + 0.33 * np.sin(2.0 * np.pi * f_pipe2 * t)
            + 0.25 * grain_impacts
        )
    elif signature_class == "cavitation_burst":
        env = np.full(n_samples, 0.06, dtype=np.float64)
        n_bursts = int(14 + head_m / 20.0)
        for center in rng.integers(0, max(1, n_samples - 320), size=n_bursts):
            decay = 2.6 * np.exp(-np.arange(320) / 42.0)
            env[center : center + 320] += decay
        anomaly = env * hf_damping * (
            0.52 * np.sin(2.0 * np.pi * 5350.0 * t + white * 0.4)
            + 0.42 * np.sin(2.0 * np.pi * 6480.0 * t)
        )

    snr_linear = 10.0 ** (snr_db / 20.0)
    noise_scale = 0.08 / max(0.25, snr_linear)
    signal = (baseline * 0.55 + anomaly * 0.95) * dist_gain + white * noise_scale
    return np.clip(signal, -0.99, 0.99).astype(np.float32)


def save_wav(filepath: str, signal: np.ndarray, sample_rate: int = 16000) -> None:
    os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
    pcm16 = (np.clip(signal, -1.0, 1.0) * 32767.0).astype(np.int16)
    with wave.open(filepath, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic dam leak audio dataset")
    parser.add_argument("--out-dir", default="./dataset_wav", help="Output directory for WAV files")
    parser.add_argument("--samples-per-class", type=int, default=20, help="WAV count per class")
    args = parser.parse_args()

    for label_idx, cls_name in enumerate(CLASSES):
        for i in range(args.samples_per_class):
            sig = synthesize_hydrophone_wave(signature_class=cls_name, seed=1000 + label_idx * 100 + i)
            out_path = os.path.join(args.out_dir, cls_name, f"{cls_name}_{i:03d}.wav")
            save_wav(out_path, sig)
    print(f"Successfully generated synthetic dam acoustic dataset in {args.out_dir}")
