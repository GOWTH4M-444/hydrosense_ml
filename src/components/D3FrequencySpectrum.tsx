/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { SynthesizedSignal } from '../utils/acousticEngine';

export interface CharacteristicLeakBand {
  id: string;
  name: string;
  shortName: string;
  minHz: number;
  maxHz: number;
  color: string;
  strokeColor: string;
  fillRgba: string;
  badgeBg: string;
  badgeText: string;
  description: string;
  iconSymbol: string;
}

export const CHARACTERISTIC_LEAK_BANDS: CharacteristicLeakBand[] = [
  {
    id: 'ambient',
    name: 'Turbine & River Flow',
    shortName: 'Turbine Hum',
    minHz: 0,
    maxHz: 400,
    color: '#059669', // Emerald
    strokeColor: '#10b981',
    fillRgba: 'rgba(16, 185, 129, 0.12)',
    badgeBg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    badgeText: 'text-emerald-700',
    description: 'Safe baseline: low-frequency turbine rumble and steady water flow',
    iconSymbol: '🟢',
  },
  {
    id: 'piping',
    name: 'Internal Piping & Sand Erosion',
    shortName: 'Piping Seepage',
    minHz: 400,
    maxHz: 1800,
    color: '#d97706', // Amber
    strokeColor: '#f59e0b',
    fillRgba: 'rgba(245, 158, 11, 0.12)',
    badgeBg: 'bg-amber-50 text-amber-800 border-amber-200',
    badgeText: 'text-amber-700',
    description: 'Soil transport & pebble friction underneath the dam foundation',
    iconSymbol: '⚠️',
  },
  {
    id: 'fissure',
    name: 'High-Pressure Fissure Jet',
    shortName: 'Fissure Jet',
    minHz: 1800,
    maxHz: 4800,
    color: '#0284c7', // Sky Blue
    strokeColor: '#0ea5e9',
    fillRgba: 'rgba(14, 165, 233, 0.14)',
    badgeBg: 'bg-sky-50 text-sky-800 border-sky-200',
    badgeText: 'text-sky-700',
    description: 'High-velocity fluid shear screaming through narrow structural cracks',
    iconSymbol: '⚡',
  },
  {
    id: 'cavitation',
    name: 'Cavitation Micro-Implosions',
    shortName: 'Cavitation Snaps',
    minHz: 4800,
    maxHz: 8000,
    color: '#e11d48', // Rose
    strokeColor: '#f43f5e',
    fillRgba: 'rgba(244, 63, 94, 0.14)',
    badgeBg: 'bg-rose-50 text-rose-800 border-rose-200',
    badgeText: 'text-rose-700',
    description: 'Vapor bubble collapse shocks eroding concrete and valve faces',
    iconSymbol: '💥',
  },
];

export interface D3FrequencySpectrumProps {
  signal: SynthesizedSignal;
  liveFrameIdx: number | null;
  isPlaying: boolean;
  isOverlay?: boolean;
  hideLegend?: boolean;
  onHoverSpectrum?: (info: {
    freqHz: number;
    magDb: number;
    bandName: string;
    leakRisk: string;
  } | null) => void;
}

export const D3FrequencySpectrum: React.FC<D3FrequencySpectrumProps> = ({
  signal,
  liveFrameIdx,
  isPlaying,
  isOverlay = false,
  hideLegend = false,
  onHoverSpectrum,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeBandFilter, setActiveBandFilter] = useState<string | null>(null);

  // Compute instantaneous or integrated frequency-magnitude array
  const spectrumPoints = useMemo<{ freq: number; db: number }[]>(() => {
    const freqs = signal.fftFrequencies;
    const mags = signal.fftMagnitudesDb;

    // When audio is playing and a live spectrogram frame is active, modulate magnitudes with frame energy
    if (liveFrameIdx !== null && signal.spectrogramFrames[liveFrameIdx]) {
      const frameBins = signal.spectrogramFrames[liveFrameIdx]; // 64 bins
      return Array.from(freqs).map((f, i) => {
        const binIdx = Math.min(
          frameBins.length - 1,
          Math.floor((f / (signal.sampleRate / 2)) * frameBins.length)
        );
        const liveDb = frameBins[binIdx];
        // Blend overall spectral envelope (40%) with instantaneous burst (60%)
        const blendedDb = Number((mags[i] * 0.4 + liveDb * 0.6).toFixed(1));
        return { freq: f, db: Math.max(-95, Math.min(0, blendedDb)) };
      });
    }

    return Array.from(freqs).map((f, i) => ({
      freq: f,
      db: Math.max(-95, Math.min(0, Number(mags[i].toFixed(1)))),
    }));
  }, [signal, liveFrameIdx]);

  // Identify peak resonance frequency and characteristic band
  const { peakPoint, peakBand } = useMemo(() => {
    let maxPt = spectrumPoints[0] || { freq: 0, db: -90 };
    for (const pt of spectrumPoints) {
      if (pt.db > maxPt.db) {
        maxPt = pt;
      }
    }
    const band =
      CHARACTERISTIC_LEAK_BANDS.find(
        (b) => maxPt.freq >= b.minHz && maxPt.freq < b.maxHz
      ) || CHARACTERISTIC_LEAK_BANDS[0];

    return { peakPoint: maxPt, peakBand: band };
  }, [spectrumPoints]);

  // D3 Chart Rendering Effect
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 760;
    const height = 155;
    const margin = { top: 20, right: 28, bottom: 26, left: 44 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const maxFreq = signal.sampleRate / 2;

    // D3 Scales
    const xScale = d3
      .scaleLinear()
      .domain([0, maxFreq])
      .range([margin.left, width - margin.right]);

    const yScale = d3
      .scaleLinear()
      .domain([-95, 0])
      .range([height - margin.bottom, margin.top]);

    // Defs: Gradients and Clipping Paths
    const defs = svg.append('defs');

    // Spectral area gradient
    const areaGradient = defs
      .append('linearGradient')
      .attr('id', 'd3-spectral-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    areaGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', peakBand.strokeColor)
      .attr('stop-opacity', isOverlay ? 0.35 : 0.45);

    areaGradient
      .append('stop')
      .attr('offset', '70%')
      .attr('stop-color', '#0284c7')
      .attr('stop-opacity', isOverlay ? 0.12 : 0.18);

    areaGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#0f172a')
      .attr('stop-opacity', 0.02);

    // Subtle Gridlines
    const yTicks = [-20, -40, -60, -80];
    const gridGroup = svg.append('g').attr('class', 'd3-grid');

    gridGroup
      .selectAll('line.y-grid')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'y-grid')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', isOverlay ? 'rgba(255, 255, 255, 0.18)' : 'rgba(203, 213, 225, 0.55)')
      .attr('stroke-dasharray', '2,3')
      .attr('stroke-width', 1);

    // Characteristic Leak Bands (Background highlights)
    const bandsGroup = svg.append('g').attr('class', 'd3-leak-bands');

    CHARACTERISTIC_LEAK_BANDS.forEach((band) => {
      const x0 = xScale(band.minHz);
      const x1 = xScale(band.maxHz);
      const isFiltered = activeBandFilter && activeBandFilter !== band.id;
      const isCurrentPeakBand = peakBand.id === band.id;

      // Band background zone
      bandsGroup
        .append('rect')
        .attr('x', x0)
        .attr('y', margin.top)
        .attr('width', Math.max(0, x1 - x0))
        .attr('height', innerH)
        .attr('fill', band.fillRgba)
        .attr('opacity', isFiltered ? 0.2 : isCurrentPeakBand ? 1.0 : 0.65)
        .attr('cursor', 'pointer')
        .on('click', () => {
          setActiveBandFilter((prev) => (prev === band.id ? null : band.id));
        });

      // Band divider border
      bandsGroup
        .append('line')
        .attr('x1', x1)
        .attr('x2', x1)
        .attr('y1', margin.top)
        .attr('y2', height - margin.bottom)
        .attr('stroke', band.strokeColor)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-dasharray', '3,3');

      // Band label watermark in top corner
      bandsGroup
        .append('text')
        .attr('x', x0 + 6)
        .attr('y', margin.top + 12)
        .attr('font-size', '9px')
        .attr('font-family', 'ui-monospace, monospace')
        .attr('font-weight', isCurrentPeakBand ? 'bold' : '600')
        .attr('fill', band.color)
        .attr('opacity', isFiltered ? 0.3 : 0.9)
        .text(`${band.iconSymbol} ${band.shortName}`);
    });

    // D3 Line & Area Generators
    const lineGen = d3
      .line<{ freq: number; db: number }>()
      .x((d) => xScale(d.freq))
      .y((d) => yScale(d.db))
      .curve(d3.curveMonotoneX);

    const areaGen = d3
      .area<{ freq: number; db: number }>()
      .x((d) => xScale(d.freq))
      .y0(height - margin.bottom)
      .y1((d) => yScale(d.db))
      .curve(d3.curveMonotoneX);

    // Draw Filled Area
    svg
      .append('path')
      .datum(spectrumPoints)
      .attr('class', 'd3-spectrum-area')
      .attr('d', areaGen)
      .attr('fill', 'url(#d3-spectral-gradient)');

    // Draw Stroke Curve
    svg
      .append('path')
      .datum(spectrumPoints)
      .attr('class', 'd3-spectrum-line')
      .attr('d', lineGen)
      .attr('fill', 'none')
      .attr('stroke', peakBand.strokeColor)
      .attr('stroke-width', 2.0)
      .attr('stroke-linecap', 'round');

    // Spectral Centroid Line
    const centroidHz = signal.features.spectralCentroidHz;
    const centroidX = xScale(centroidHz);

    const centroidGroup = svg.append('g').attr('class', 'd3-centroid-marker');

    centroidGroup
      .append('line')
      .attr('x1', centroidX)
      .attr('x2', centroidX)
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke', '#d97706')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,3');

    centroidGroup
      .append('text')
      .attr('x', Math.min(width - margin.right - 85, centroidX + 4))
      .attr('y', height - margin.bottom - 6)
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('font-weight', '600')
      .attr('fill', '#b45309')
      .text(`Centroid ${centroidHz.toFixed(0)}Hz`);

    // Peak Frequency Marker
    const peakX = xScale(peakPoint.freq);
    const peakY = yScale(peakPoint.db);

    const peakGroup = svg.append('g').attr('class', 'd3-peak-marker');

    // Vertical dashed marker to peak
    peakGroup
      .append('line')
      .attr('x1', peakX)
      .attr('x2', peakX)
      .attr('y1', peakY)
      .attr('y2', height - margin.bottom)
      .attr('stroke', peakBand.color)
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '2,2');

    // Halo ring around peak
    peakGroup
      .append('circle')
      .attr('cx', peakX)
      .attr('cy', peakY)
      .attr('r', 6)
      .attr('fill', 'none')
      .attr('stroke', peakBand.strokeColor)
      .attr('stroke-width', 2)
      .attr('opacity', 0.85);

    // Center dot
    peakGroup
      .append('circle')
      .attr('cx', peakX)
      .attr('cy', peakY)
      .attr('r', 3)
      .attr('fill', '#ffffff')
      .attr('stroke', peakBand.color)
      .attr('stroke-width', 1.5);

    // Peak callout badge text
    const badgeText = `${peakPoint.freq.toFixed(0)} Hz (${peakPoint.db} dB)`;
    const textX = Math.max(margin.left + 50, Math.min(width - margin.right - 60, peakX));
    const textY = Math.max(margin.top + 10, peakY - 10);

    peakGroup
      .append('rect')
      .attr('x', textX - 42)
      .attr('y', textY - 11)
      .attr('width', 84)
      .attr('height', 15)
      .attr('rx', 3)
      .attr('fill', isOverlay ? 'rgba(15, 23, 42, 0.9)' : '#ffffff')
      .attr('stroke', peakBand.color)
      .attr('stroke-width', 1);

    peakGroup
      .append('text')
      .attr('x', textX)
      .attr('y', textY)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('font-weight', 'bold')
      .attr('fill', peakBand.color)
      .text(badgeText);

    // D3 Axes
    // X Axis
    const xAxis = d3
      .axisBottom(xScale)
      .tickValues([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000])
      .tickFormat((d) => `${(Number(d) / 1000).toFixed(0)}k`);

    const xAxisGroup = svg
      .append('g')
      .attr('class', 'd3-x-axis')
      .attr('transform', `translate(0, ${height - margin.bottom})`)
      .call(xAxis);

    xAxisGroup.select('.domain').attr('stroke', 'rgba(148, 163, 184, 0.5)');
    xAxisGroup.selectAll('.tick line').attr('stroke', 'rgba(148, 163, 184, 0.4)');
    xAxisGroup
      .selectAll('.tick text')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('fill', isOverlay ? '#cbd5e1' : '#64748b');

    // Y Axis (dB)
    const yAxis = d3
      .axisLeft(yScale)
      .tickValues([0, -20, -40, -60, -80])
      .tickFormat((d) => `${d}`);

    const yAxisGroup = svg
      .append('g')
      .attr('class', 'd3-y-axis')
      .attr('transform', `translate(${margin.left}, 0)`)
      .call(yAxis);

    yAxisGroup.select('.domain').attr('stroke', 'rgba(148, 163, 184, 0.5)');
    yAxisGroup.selectAll('.tick line').attr('stroke', 'rgba(148, 163, 184, 0.4)');
    yAxisGroup
      .selectAll('.tick text')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('fill', isOverlay ? '#cbd5e1' : '#64748b');

    // Axis Units Label
    svg
      .append('text')
      .attr('x', margin.left + 2)
      .attr('y', margin.top - 6)
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('fill', '#94a3b8')
      .text('dB/Hz');

    svg
      .append('text')
      .attr('x', width - margin.right)
      .attr('y', height - margin.bottom - 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('fill', '#94a3b8')
      .text('Freq (Hz)');

    // Interactive Crosshair & Tooltip Overlay
    const focusGroup = svg.append('g').attr('class', 'd3-focus').style('display', 'none');

    const focusLine = focusGroup
      .append('line')
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke', '#38bdf8')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '3,3');

    const focusCircle = focusGroup
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', '#0284c7')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2);

    // Interactive mouse capture rect
    svg
      .append('rect')
      .attr('class', 'd3-mouse-overlay')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .attr('cursor', 'crosshair')
      .on('mouseenter', () => focusGroup.style('display', null))
      .on('mouseleave', () => {
        focusGroup.style('display', 'none');
        if (onHoverSpectrum) onHoverSpectrum(null);
      })
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const freqAtMouse = xScale.invert(mx);

        // Find closest point in spectrumPoints
        const bisect = d3.bisector<{ freq: number; db: number }, number>((d) => d.freq).center;
        const idx = bisect(spectrumPoints, freqAtMouse);
        const pt = spectrumPoints[Math.min(spectrumPoints.length - 1, Math.max(0, idx))];

        if (!pt) return;

        const xPos = xScale(pt.freq);
        const yPos = yScale(pt.db);

        focusLine.attr('x1', xPos).attr('x2', xPos);
        focusCircle.attr('cx', xPos).attr('cy', yPos);

        const band =
          CHARACTERISTIC_LEAK_BANDS.find((b) => pt.freq >= b.minHz && pt.freq < b.maxHz) ||
          CHARACTERISTIC_LEAK_BANDS[0];

        if (onHoverSpectrum) {
          onHoverSpectrum({
            freqHz: Math.round(pt.freq),
            magDb: pt.db,
            bandName: band.name,
            leakRisk: band.description,
          });
        }
      });
  }, [signal, spectrumPoints, peakPoint, peakBand, isOverlay, onHoverSpectrum, activeBandFilter]);

  return (
    <div className="w-full select-none">
      {/* SVG Container */}
      <div
        className={`relative rounded-lg overflow-hidden ${
          isOverlay
            ? 'bg-transparent border-0'
            : 'border border-slate-200/90 bg-slate-900/95 shadow-inner'
        }`}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 760 155"
          className="w-full h-[155px] block font-sans"
          data-testid="d3-frequency-spectrum-svg"
          preserveAspectRatio="none"
        />
      </div>

      {/* Characteristic Leak Frequencies Legend / Inspector Chips */}
      {!hideLegend && (
        <CharacteristicBandsLegend
          activeBandFilter={activeBandFilter}
          onToggleFilter={(id) => setActiveBandFilter((prev) => (prev === id ? null : id))}
          peakBandId={peakBand.id}
        />
      )}
    </div>
  );
};

export const CharacteristicBandsLegend: React.FC<{
  activeBandFilter: string | null;
  onToggleFilter: (id: string) => void;
  peakBandId?: string;
}> = ({ activeBandFilter, onToggleFilter, peakBandId }) => {
  return (
    <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
      {CHARACTERISTIC_LEAK_BANDS.map((band) => {
        const isSelected = activeBandFilter === band.id;
        const isCurrentPeak = peakBandId === band.id;
        return (
          <button
            key={band.id}
            type="button"
            onClick={() => onToggleFilter(band.id)}
            title={band.description}
            className={`px-2 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
              isSelected
                ? 'bg-slate-900 text-white border-slate-700 shadow-xs ring-1 ring-sky-400'
                : isCurrentPeak
                ? `${band.badgeBg} font-bold ring-1 ring-offset-0 ring-current shadow-2xs`
                : 'bg-slate-50/80 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="font-semibold truncate">
                {band.iconSymbol} {band.shortName}
              </span>
              {isCurrentPeak && (
                <span className="text-[9px] font-mono uppercase px-1 rounded bg-white/80 border border-current text-slate-900 font-extrabold">
                  Peak
                </span>
              )}
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              {band.minHz === 0 ? '0' : `${band.minHz / 1000}k`}–{band.maxHz / 1000}k Hz
            </div>
          </button>
        );
      })}
    </div>
  );
};
