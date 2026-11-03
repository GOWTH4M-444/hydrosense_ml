import React, { useState } from 'react';
import { computeTDOALocalization, TDOALocalizationResult } from '../utils/acousticEngine';

export interface LoggedAnomalyEvent {
  id: string;
  timestamp: string;
  monolithZone: string;
  trueCoords: string;
  estimatedCoords: string;
  errorMeters: number;
  severity: 'Nominal' | 'Drifting' | 'Critical';
  notes: string;
}

interface DamArrayTdoaViewProps {
  onSelectHydrophoneZone?: (distanceMeters: number, headMeters: number) => void;
}

export const DamArrayTdoaView: React.FC<DamArrayTdoaViewProps> = ({
  onSelectHydrophoneZone,
}) => {
  const [leakX, setLeakX] = useState<number>(21.5);
  const [leakY, setLeakY] = useState<number>(38.0);
  const [jitterMs, setJitterMs] = useState<number>(0.05);
  const [inspectionNote, setInspectionNote] = useState<string>(
    'Elevated high-frequency acoustic emission localized near Monolith 14 drainage curtain.'
  );
  const [anomalyLog, setAnomalyLog] = useState<LoggedAnomalyEvent[]>([
    {
      id: 'LOG-104',
      timestamp: '2026-11-02 20:45:12',
      monolithZone: 'Upper Core Monolith',
      trueCoords: '(21.5m, 38.0m)',
      estimatedCoords: '(21.5m, 38.0m)',
      errorMeters: 0.22,
      severity: 'Critical',
      notes: 'Initial TDOA cross-correlation lock on 2.8 kHz fissure jetting signature.',
    },
    {
      id: 'LOG-103',
      timestamp: '2026-11-02 19:10:04',
      monolithZone: 'Grout Curtain Plinth',
      trueCoords: '(19.0m, 18.5m)',
      estimatedCoords: '(19.5m, 18.5m)',
      errorMeters: 0.5,
      severity: 'Drifting',
      notes: 'Minor mid-band seepage modulation detected below Foundation Gallery H3.',
    },
  ]);

  const tdoaResult: TDOALocalizationResult = computeTDOALocalization(leakX, leakY, jitterMs);

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    // Map SVG coordinate space (0..75m X, 0..90m Y inverted)
    const mappedX = Math.max(4, Math.min(68, Number((relX * 75).toFixed(1))));
    const mappedY = Math.max(6, Math.min(82, Number(((1 - relY) * 90).toFixed(1))));
    setLeakX(mappedX);
    setLeakY(mappedY);
  };

  const handleRecordAnomaly = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inspectionNote.trim();
    if (!trimmed) return;

    const closestReading = [...tdoaResult.readings].sort(
      (a, b) => a.distanceMeters - b.distanceMeters
    )[0];

    const newEntry: LoggedAnomalyEvent = {
      id: `LOG-${105 + anomalyLog.length}`,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      monolithZone: closestReading.zone,
      trueCoords: `(${tdoaResult.trueSourceX.toFixed(1)}m, ${tdoaResult.trueSourceY.toFixed(1)}m)`,
      estimatedCoords: `(${tdoaResult.estimatedX.toFixed(1)}m, ${tdoaResult.estimatedY.toFixed(1)}m)`,
      errorMeters: tdoaResult.localizationErrorMeters,
      severity: tdoaResult.trueSourceY < 25 ? 'Drifting' : 'Critical',
      notes: trimmed,
    };

    setAnomalyLog([newEntry, ...anomalyLog]);
    setInspectionNote('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: TDOA Controls & Hydrophone Array Telemetry */}
      <div className="lg:col-span-5 flex flex-col gap-5">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-1">
            Find the Hidden Leak Inside the Dam
          </h2>
          <p className="text-xs text-slate-600 mb-4">
            Click anywhere on the big dam picture or slide the bars! Four underwater microphones listen to see which one hears the sound wave first.
          </p>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="leak-x-slider" className="font-medium text-slate-700">
                  Left to Right Spot
                </label>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {leakX.toFixed(1)} m
                </span>
              </div>
              <input
                id="leak-x-slider"
                type="range"
                min={5}
                max={65}
                step={0.5}
                value={leakX}
                onChange={(e) => setLeakX( parseFloat(e.target.value) )}
                className="w-full accent-sky-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="leak-y-slider" className="font-medium text-slate-700">
                  Bottom to Top Height
                </label>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {leakY.toFixed(1)} m
                </span>
              </div>
              <input
                id="leak-y-slider"
                type="range"
                min={6}
                max={80}
                step={0.5}
                value={leakY}
                onChange={(e) => setLeakY( parseFloat(e.target.value) )}
                className="w-full accent-sky-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label htmlFor="jitter-slider" className="font-medium text-slate-700">
                  Water Echo Wobble
                </label>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {jitterMs.toFixed(2)} ms
                </span>
              </div>
              <input
                id="jitter-slider"
                type="range"
                min={0.0}
                max={0.25}
                step={0.01}
                value={jitterMs}
                onChange={(e) => setJitterMs( parseFloat(e.target.value) )}
                className="w-full accent-sky-600 cursor-pointer"
              />
            </div>
          </div>

          {/* TDOA Solver Readout Grid */}
          <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-200">
            <div>
              <div className="text-xs text-slate-500">Real Leak Spot</div>
              <div className="text-sm font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                ({tdoaResult.trueSourceX.toFixed(1)}, {tdoaResult.trueSourceY.toFixed(1)}) m
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Computer Found Spot</div>
              <div className="text-sm font-mono font-semibold text-sky-700 tabular-nums mt-0.5">
                ({tdoaResult.estimatedX.toFixed(1)}, {tdoaResult.estimatedY.toFixed(1)}) m
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">How Close?</div>
              <div className="text-sm font-mono font-semibold text-emerald-700 tabular-nums mt-0.5">
                ±{tdoaResult.localizationErrorMeters.toFixed(2)} m
              </div>
            </div>
          </div>
        </div>

        {/* Hydrophone Array Table */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            4 Underwater Microphones (Who Heard It First?)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-2 font-medium">Microphone</th>
                  <th className="py-2 px-2 font-medium">How Far</th>
                  <th className="py-2 px-2 font-medium">Travel Time</th>
                  <th className="py-2 px-2 font-medium">Time Gap</th>
                  <th className="py-2 pl-2 font-medium text-right">Try It</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {tdoaResult.readings.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-2 font-sans font-medium text-slate-900">
                      {r.name}
                    </td>
                    <td className="py-2.5 px-2 text-slate-700">{r.distanceMeters.toFixed(1)} m</td>
                    <td className="py-2.5 px-2 text-slate-700">{r.arrivalTimeMs.toFixed(2)} ms</td>
                    <td className="py-2.5 px-2 text-sky-700">
                      {r.tdoaRelativeToRefMs >= 0 ? `+${r.tdoaRelativeToRefMs.toFixed(2)}` : r.tdoaRelativeToRefMs.toFixed(2)} ms
                    </td>
                    <td className="py-2.5 pl-2 text-right font-sans">
                      {onSelectHydrophoneZone && (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectHydrophoneZone(
                              r.distanceMeters,
                              Math.max(15, Math.round(90 - leakY + 25))
                            )
                          }
                          className="text-xs font-medium text-sky-700 hover:text-sky-900 underline whitespace-nowrap cursor-pointer"
                        >
                          Listen Here
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Column: Interactive Dam Cross-Section Schematic & Anomaly Log */}
      <div className="lg:col-span-7 flex flex-col gap-5">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Inside the Giant Dam Wall (Click Anywhere to Move the Leak!)
              </h2>
              <p className="text-xs text-slate-500">
                The red dot is the hidden leak · Blue dots are microphones · Yellow plus (+) is where the computer found it!
              </p>
            </div>
            <div className="text-xs font-mono text-slate-600 tabular-nums">
              Sound Speed: {tdoaResult.propagationVelocityMps} m/s
            </div>
          </div>

          <div className="border border-slate-200 rounded bg-slate-900 overflow-hidden">
            <svg
              viewBox="0 0 750 420"
              onClick={handleSvgClick}
              data-testid="dam-cross-section-svg"
              className="w-full h-[320px] block cursor-crosshair select-none"
            >
              {/* Upstream Reservoir Water Body */}
              <rect x="0" y="52" width="80" height="328" fill="rgba(14, 116, 144, 0.38)" />
              <line
                x1="0"
                y1="52"
                x2="80"
                y2="52"
                stroke="#38BDF8"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
              <text x="10" y="24" fill="#7DD3FC" fontSize="11" fontFamily="JetBrains Mono">
                DEEP LAKE WATER (82m HIGH)
              </text>

              {/* Foundation Bedrock */}
              <rect x="0" y="380" width="750" height="40" fill="#1E2330" />
              <line x1="0" y1="380" x2="750" y2="380" stroke="#475569" strokeWidth="2" />
              <text x="16" y="403" fill="#94A3B8" fontSize="11" fontFamily="JetBrains Mono">
                SOLID ROCK GROUND UNDER THE DAM
              </text>

              {/* Concrete Gravity Dam Monolith Polygon */}
              <polygon
                points="80,380 80,38 230,38 640,380"
                fill="#334155"
                stroke="#94A3B8"
                strokeWidth="2"
              />

              {/* Internal Inspection Galleries */}
              <rect
                x="195"
                y="155"
                width="36"
                height="44"
                rx="4"
                fill="#0F172A"
                stroke="#64748B"
                strokeWidth="1.5"
              />
              <rect
                x="160"
                y="300"
                width="36"
                height="44"
                rx="4"
                fill="#0F172A"
                stroke="#64748B"
                strokeWidth="1.5"
              />

              {/* Coordinate Grid Lines */}
              {[150, 300, 450, 600].map((gx) => (
                <line
                  key={gx}
                  x1={gx}
                  y1={0}
                  x2={gx}
                  y2={380}
                  stroke="rgba(148, 163, 184, 0.12)"
                  strokeWidth="1"
                />
              ))}

              {/* Acoustic Propagation Ray Paths from Leak Source to Hydrophones */}
              {tdoaResult.readings.map((h) => {
                const sx = (tdoaResult.trueSourceX / 75) * 750;
                const sy = (1 - tdoaResult.trueSourceY / 90) * 420;
                const hx = (h.xMeters / 75) * 750;
                const hy = (1 - h.yMeters / 90) * 420;
                return (
                  <g key={h.id}>
                    <line
                      x1={sx}
                      y1={sy}
                      x2={hx}
                      y2={hy}
                      stroke="rgba(56, 189, 248, 0.55)"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                    />
                    <circle
                      cx={hx}
                      cy={hy}
                      r={7}
                      fill="#0284C7"
                      stroke="#E0F2FE"
                      strokeWidth="2"
                    />
                    <text
                      x={hx + 11}
                      y={hy + 4}
                      fill="#F8FAFC"
                      fontSize="11"
                      fontFamily="JetBrains Mono"
                      fontWeight="600"
                    >
                      {h.id} ({h.arrivalTimeMs.toFixed(1)}ms)
                    </text>
                  </g>
                );
              })}

              {/* True Leak Source Marker & Concentric Wavefront Rings */}
              {(() => {
                const sx = (tdoaResult.trueSourceX / 75) * 750;
                const sy = (1 - tdoaResult.trueSourceY / 90) * 420;
                const ex = (tdoaResult.estimatedX / 75) * 750;
                const ey = (1 - tdoaResult.estimatedY / 90) * 420;
                return (
                  <g>
                    <circle
                      cx={sx}
                      cy={sy}
                      r={24}
                      fill="none"
                      stroke="rgba(244, 63, 94, 0.45)"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={sx}
                      cy={sy}
                      r={48}
                      fill="none"
                      stroke="rgba(244, 63, 94, 0.25)"
                      strokeWidth="1"
                    />
                    <circle
                      cx={sx}
                      cy={sy}
                      r={7}
                      fill="#E11D48"
                      stroke="#FFE4E6"
                      strokeWidth="2"
                    />
                    {/* Estimated TDOA Crosshair */}
                    <line
                      x1={ex - 10}
                      y1={ey}
                      x2={ex + 10}
                      y2={ey}
                      stroke="#FBBF24"
                      strokeWidth="2"
                    />
                    <line
                      x1={ex}
                      y1={ey - 10}
                      x2={ex}
                      y2={ey + 10}
                      stroke="#FBBF24"
                      strokeWidth="2"
                    />
                    <text
                      x={sx + 12}
                      y={sy - 10}
                      fill="#FDA4AF"
                      fontSize="11"
                      fontFamily="JetBrains Mono"
                      fontWeight="600"
                    >
                      LEAK SPOT ({tdoaResult.trueSourceX}m, {tdoaResult.trueSourceY}m)
                    </text>
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* Structural Anomaly Log & Form */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">
            Dam Detective Notebook (Write Down What You Found)
          </h3>
          <form onSubmit={handleRecordAnomaly} className="flex flex-col sm:flex-row gap-2.5 mb-4">
            <label htmlFor="anomaly-note-input" className="sr-only">
              Detective Note
            </label>
            <input
              id="anomaly-note-input"
              type="text"
              value={inspectionNote}
              onChange={(e) => setInspectionNote(e.target.value)}
              placeholder="Write a note about this leak spot..."
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Save Leak Note
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-2 font-medium">Note # · Time</th>
                  <th className="py-2 px-2 font-medium">Part of Dam</th>
                  <th className="py-2 px-2 font-medium">Found Spot</th>
                  <th className="py-2 px-2 font-medium">Danger Level</th>
                  <th className="py-2 pl-2 font-medium">Detective Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {anomalyLog.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-2.5 pr-2 font-mono text-slate-700 whitespace-nowrap tabular-nums">
                      {entry.id} · {entry.timestamp.slice(11)}
                    </td>
                    <td className="py-2.5 px-2 font-medium text-slate-900 whitespace-nowrap">
                      {entry.monolithZone}
                    </td>
                    <td className="py-2.5 px-2 font-mono text-slate-700 whitespace-nowrap tabular-nums">
                      {entry.estimatedCoords} (±{entry.errorMeters}m)
                    </td>
                    <td className="py-2.5 px-2 whitespace-nowrap font-mono">
                      {entry.severity === 'Critical' && (
                        <span className="text-rose-600 font-semibold">✖ Big Leak</span>
                      )}
                      {entry.severity === 'Drifting' && (
                        <span className="text-amber-600 font-semibold">▲ Small Trickle</span>
                      )}
                      {entry.severity === 'Nominal' && (
                        <span className="text-emerald-600 font-semibold">● Safe</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-2 text-slate-600">{entry.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
