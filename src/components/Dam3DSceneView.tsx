import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Box,
  Compass,
  Eye,
  EyeOff,
  Layers,
  RotateCcw,
  Radio,
  Waves,
  Droplets,
  Sliders,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Crosshair,
} from 'lucide-react';
import {
  AcousticClassId,
  DamBaseLeakParticleConfig,
  Dam3DRegimeAnimationProfile,
  DamOrificeDeformationState,
  GeneratorParams,
  CRITICAL_ORIFICE_DEFORMATION_THRESHOLD_MM,
  calculateAcousticPulsePeriodMs,
  calculateAcousticAttenuation,
  getDam3DRegimeAnimationProfile,
  calculateDamBaseLeakParticleConfig,
  computeDamBaseParticleTransform,
  calculateDamOrificeDeformationState,
  computeMonolithVertexDeformationOffset,
} from '../utils/acousticEngine';

// Suppress internal THREE.Clock deprecation warning emitted by @react-three/fiber store initialization on Three.js r187+
if (typeof console !== 'undefined' && !(console as unknown as { _r3fClockFiltered?: boolean })._r3fClockFiltered) {
  const origWarn = console.warn.bind(console);
  (console as unknown as { _r3fClockFiltered?: boolean })._r3fClockFiltered = true;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('THREE.Clock: This module has been deprecated')) {
      return;
    }
    origWarn(...args);
  };
}

// Detect software WebGL (SwiftShader / llvmpipe) once at module load per Three.js skill guidelines
const IS_SOFTWARE_GL = (() => {
  if (typeof document === 'undefined') return false;
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Mesa OffScreen/i.test(gpu);
  } catch {
    return false;
  }
})();

interface Dam3DSceneViewProps {
  params: GeneratorParams;
  activePresetKey: string;
  onUpdateParam: <K extends keyof GeneratorParams>(key: K, value: GeneratorParams[K]) => void;
  onSelectPreset: (presetKey: string) => void;
  whimsicalName?: string;
  onJumpToWorkbench?: () => void;
  leakProbability?: number;
}

type CameraPresetId =
  | 'overview'
  | 'base_leak'
  | 'leak'
  | 'piping'
  | 'cavitation'
  | 'upstream'
  | 'downstream';

interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'overview',
    label: 'Dam Overview',
    position: [-6, 30, 52],
    target: [0, 3, 2],
  },
  {
    id: 'base_leak',
    label: 'Dam Base Bubbles',
    position: [-10, 16, 38],
    target: [-3.5, 1.5, 14],
  },
  {
    id: 'leak',
    label: 'Crack Fissure Zone',
    position: [-9, 15, 34],
    target: [-2, 6, 8],
  },
  {
    id: 'piping',
    label: 'Piping Foundation',
    position: [-12, 12, 38],
    target: [-4, -3, 15],
  },
  {
    id: 'cavitation',
    label: 'Cavitation Intake',
    position: [28, 9, 34],
    target: [18, -1, 12],
  },
  {
    id: 'upstream',
    label: 'Hydrophone Buoy',
    position: [-18, 16, 38],
    target: [-4, 2, 12],
  },
  {
    id: 'downstream',
    label: 'Downstream Powerhouse',
    position: [26, 20, -48],
    target: [2, -4, -14],
  },
];

const SOUND_TYPE_OPTIONS: {
  classId: AcousticClassId;
  presetKey: string;
  shortLabel: string;
  dangerLevel: 'SAFE' | 'WARNING' | 'DANGER';
  cameraPreset: CameraPresetId;
}[] = [
  {
    classId: 'hairline_fissure',
    presetKey: 'fissure_monolith_14',
    shortLabel: 'Fast Crack Spray',
    dangerLevel: 'DANGER',
    cameraPreset: 'leak',
  },
  {
    classId: 'cavitation_burst',
    presetKey: 'conduit_cavitation_shock',
    shortLabel: 'Popping Cavitation',
    dangerLevel: 'DANGER',
    cameraPreset: 'cavitation',
  },
  {
    classId: 'internal_piping',
    presetKey: 'foundation_piping_curtain',
    shortLabel: 'Muddy Piping Trickle',
    dangerLevel: 'WARNING',
    cameraPreset: 'piping',
  },
  {
    classId: 'normal_ambient',
    presetKey: 'nominal_baseline',
    shortLabel: 'Calm River Hum',
    dangerLevel: 'SAFE',
    cameraPreset: 'overview',
  },
];

// Module-scope reusable scratch objects to avoid GC pressure in useFrame()
const _vec3 = new THREE.Vector3();
const _targetVec3 = new THREE.Vector3();
const _camPosVec3 = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scaleVec3 = new THREE.Vector3();
const _euler = new THREE.Euler();

const _r3fPos = new THREE.Vector3();
const _r3fScale = new THREE.Vector3();
const _r3fQuat = new THREE.Quaternion();
const _r3fMatrix = new THREE.Matrix4();

const _spallPos = new THREE.Vector3();
const _spallScale = new THREE.Vector3();
const _spallQuat = new THREE.Quaternion();
const _spallEuler = new THREE.Euler();
const _spallMatrix = new THREE.Matrix4();

/**
 * Generates a procedural rock/concrete bump & diffuse canvas texture
 */
function createProceduralConcreteTexture(
  baseHex: string,
  speckleDarkHex: string,
  speckleLightHex: string,
  addFormworkLines: boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    let s = 42;
    const rand = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };

    for (let i = 0; i < 3200; i++) {
      const x = Math.floor(rand() * 256);
      const y = Math.floor(rand() * 256);
      const w = 1 + Math.floor(rand() * 3);
      const h = 1 + Math.floor(rand() * 3);
      ctx.fillStyle = rand() > 0.5 ? speckleDarkHex : speckleLightHex;
      ctx.globalAlpha = 0.08 + rand() * 0.14;
      ctx.fillRect(x, y, w, h);
    }

    if (addFormworkLines) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = speckleDarkHex;
      ctx.lineWidth = 1;
      for (let y = 0; y < 256; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
      for (let x = 0; x < 256; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3);
  return tex;
}

/**
 * Generates a high-contrast procedural structural fracture & spalling crack decal texture
 * rendered conditionally when orificeDiameterMm > 15mm.
 */
function createProceduralCrackOverlayTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 512, 512);

    // 1. Concrete spalling & moisture weeping stain halo around the fracture spine
    const haloGrad = ctx.createRadialGradient(256, 256, 18, 256, 256, 225);
    haloGrad.addColorStop(0, 'rgba(15, 23, 42, 0.92)');
    haloGrad.addColorStop(0.35, 'rgba(30, 41, 59, 0.72)');
    haloGrad.addColorStop(0.7, 'rgba(51, 65, 85, 0.32)');
    haloGrad.addColorStop(1, 'rgba(15, 23, 42, 0.0)');
    ctx.fillStyle = haloGrad;
    ctx.fillRect(0, 0, 512, 512);

    // 2. Jagged main fracture spine points from top to bottom of Block #14
    const spinePoints: [number, number][] = [
      [256, 18],
      [234, 72],
      [274, 128],
      [226, 188],
      [278, 248],
      [222, 310],
      [268, 372],
      [238, 434],
      [258, 492],
    ];

    // Outer crushed concrete bevel edge
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
    ctx.shadowColor = 'rgba(239, 68, 68, 0.95)';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 34;
    ctx.beginPath();
    spinePoints.forEach(([x, y], idx) => {
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Deep abyssal fracture chasm interior
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#020617';
    ctx.lineWidth = 20;
    ctx.beginPath();
    spinePoints.forEach(([x, y], idx) => {
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Glowing pressurized internal hydro-fracture core line
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 5;
    ctx.beginPath();
    spinePoints.forEach(([x, y], idx) => {
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 3. Secondary branching radial shear cracks
    const branches: [number, number][][] = [
      [
        [234, 72],
        [170, 96],
        [124, 134],
      ],
      [
        [274, 128],
        [342, 154],
        [398, 198],
      ],
      [
        [226, 188],
        [148, 212],
        [92, 260],
      ],
      [
        [278, 248],
        [356, 278],
        [416, 326],
      ],
      [
        [222, 310],
        [152, 348],
        [104, 396],
      ],
      [
        [268, 372],
        [338, 410],
        [388, 452],
      ],
    ];

    branches.forEach((branch) => {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.72)';
      ctx.lineWidth = 11;
      ctx.beginPath();
      branch.forEach(([bx, by], i) => {
        if (i === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      });
      ctx.stroke();

      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 5;
      ctx.beginPath();
      branch.forEach(([bx, by], i) => {
        if (i === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      });
      ctx.stroke();
    });
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Conditional React-Three-Fiber Structural Crack Texture & Mesh Deformation Overlay
 * Rendered inside the 3D dam model ONLY when `orificeDiameterMm > 15mm`.
 */
interface MonolithCrackDeformationOverlayProps {
  state: DamOrificeDeformationState;
  visible: boolean;
}

const MonolithCrackDeformationOverlay: React.FC<MonolithCrackDeformationOverlayProps> = ({
  state,
  visible,
}) => {
  const decalMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const leftSlabRef = useRef<THREE.Mesh | null>(null);
  const rightSlabRef = useRef<THREE.Mesh | null>(null);
  const spallInstRef = useRef<THREE.InstancedMesh | null>(null);
  const startTimeRef = useRef<number>(performance.now());

  const crackOverlayTex = useMemo(() => createProceduralCrackOverlayTexture(), []);

  useEffect(() => {
    return () => {
      crackOverlayTex.dispose();
    };
  }, [crackOverlayTex]);

  const slopeAngleX = -Math.atan2(14.0, 30.0);
  const getUpstreamFaceZ = (y: number) => 4.35 + ((15 - y) / 30) * 14.0;
  const centerZ = getUpstreamFaceZ(5.5);

  useFrame(() => {
    if (!state.isDeformed || !visible) return;
    const elapsedSec = (performance.now() - startTimeRef.current) * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 6.5);
    const amp = state.vertexDisplacementAmplitude;

    if (decalMatRef.current) {
      decalMatRef.current.opacity = state.crackTextureOpacity;
      decalMatRef.current.emissiveIntensity =
        1.1 + 1.15 * pulse * (0.5 + state.normalizedSeverity * 0.5);
    }

    // Displace the buckled concrete breach slabs outward & laterally as orificeDiameterMm grows past 15mm
    if (leftSlabRef.current && rightSlabRef.current) {
      const lateralSplit = 0.55 + state.canyonFractureSpreadFactor * 0.45 + 0.08 * pulse;
      const buckleOutZ = centerZ + 0.28 + amp * 0.25 + 0.06 * pulse;
      leftSlabRef.current.position.set(-3.2 - lateralSplit, 5.5, buckleOutZ);
      rightSlabRef.current.position.set(-3.2 + lateralSplit, 5.5, buckleOutZ);
      leftSlabRef.current.rotation.set(slopeAngleX, -0.22 - state.normalizedSeverity * 0.18, 0.06);
      rightSlabRef.current.rotation.set(slopeAngleX, 0.22 + state.normalizedSeverity * 0.18, -0.06);
    }

    // Animate tumbling spalling concrete chunks ejecting from the deformed breach seam
    const spallMesh = spallInstRef.current;
    if (spallMesh) {
      const count = state.spallingDebrisCount;
      for (let i = 0; i < 48; i++) {
        if (i >= count) {
          _spallPos.set(0, -200, 0);
          _spallScale.set(0, 0, 0);
        } else {
          const cycle = (elapsedSec * (0.65 + (i % 5) * 0.12) + i * 0.17) % 1.0;
          const originY = -1.5 + ((i * 19) % 140) * 0.1;
          const originZ = getUpstreamFaceZ(originY) + 0.42;
          const spreadX = -3.2 + Math.sin(i * 4.3) * (0.6 + cycle * 3.2);
          const fallY = originY + cycle * 2.2 - cycle * cycle * 9.5;
          const ejectZ = originZ + cycle * (4.2 + state.normalizedSeverity * 3.5);
          const chunkScale = (0.35 + (i % 4) * 0.16) * (1 - cycle * 0.35);

          _spallPos.set(spreadX, fallY, ejectZ);
          _spallEuler.set(elapsedSec * 4.0 + i, elapsedSec * 3.1 + i * 0.5, i);
          _spallQuat.setFromEuler(_spallEuler);
          _spallScale.set(chunkScale, chunkScale * 0.8, chunkScale * 1.2);
        }
        _spallMatrix.compose(_spallPos, _spallQuat, _spallScale);
        spallMesh.setMatrixAt(i, _spallMatrix);
      }
      spallMesh.instanceMatrix.needsUpdate = true;
    }
  });

  if (!state.isDeformed) return null;

  return (
    <group name="MonolithCrackDeformationOverlay" visible={visible}>
      {/* 1. Procedural High-Contrast Fracture Texture Decal Plane on Block #14 Upstream Face */}
      <mesh
        position={[-3.2, 5.5, centerZ + 0.26]}
        rotation={[slopeAngleX, 0, 0]}
      >
        <planeGeometry args={[12.5, 19.5, 16, 24]} />
        <meshStandardMaterial
          ref={decalMatRef}
          map={crackOverlayTex}
          emissiveMap={crackOverlayTex}
          emissive={new THREE.Color(0xef4444)}
          emissiveIntensity={1.4}
          transparent
          opacity={state.crackTextureOpacity}
          roughness={0.85}
          metalness={0.1}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* 2. Displaced Concrete Breach Flank Slabs showing 3D Mesh Buckling */}
      <mesh ref={leftSlabRef} position={[-4.2, 5.5, centerZ + 0.4]} rotation={[slopeAngleX, -0.28, 0.05]}>
        <boxGeometry args={[1.35, 15.8, 0.85]} />
        <meshStandardMaterial color={0x475569} roughness={0.92} metalness={0.08} />
      </mesh>

      <mesh ref={rightSlabRef} position={[-2.2, 5.5, centerZ + 0.4]} rotation={[slopeAngleX, 0.28, -0.05]}>
        <boxGeometry args={[1.35, 15.8, 0.85]} />
        <meshStandardMaterial color={0x475569} roughness={0.92} metalness={0.08} />
      </mesh>

      {/* 3. Exposed Structural Steel Rebar Ribs Straining Across the Deformed Breach Chasm */}
      {[-0.5, 2.5, 5.5, 8.5, 11.5].map((rebarY, idx) => (
        <mesh
          key={rebarY}
          position={[-3.2, rebarY, getUpstreamFaceZ(rebarY) + 0.34]}
          rotation={[slopeAngleX, 0, Math.PI / 2 + (idx % 2 === 0 ? 0.12 : -0.12)]}
        >
          <cylinderGeometry args={[0.11, 0.11, 3.2 + state.canyonFractureSpreadFactor, 8]} />
          <meshStandardMaterial
            color={0x991b1b}
            emissive={0xdc2626}
            emissiveIntensity={0.95}
            roughness={0.4}
            metalness={0.85}
          />
        </mesh>
      ))}

      {/* 4. Tumbling Concrete Spalling Debris InstancedMesh */}
      <instancedMesh ref={spallInstRef} args={[undefined, undefined, 48]} frustumCulled={false}>
        <dodecahedronGeometry args={[0.52, 0]} />
        <meshStandardMaterial
          color={0x94a3b8}
          emissive={0x7f1d1d}
          emissiveIntensity={0.45}
          roughness={0.9}
          metalness={0.05}
        />
      </instancedMesh>
    </group>
  );
};

/**
 * React-Three-Fiber Particle System Component (`DamBaseLeakParticleSystem`)
 * Simulates leaking water bubbles and pressurized droplets emerging from the dam base
 * when the acoustic signal identifies a high-probability leak (leakProbability >= 50%).
 */
interface DamBaseLeakParticleSystemProps {
  config: DamBaseLeakParticleConfig;
  visible: boolean;
}

const DamBaseLeakParticleSystem: React.FC<DamBaseLeakParticleSystemProps> = ({
  config,
  visible,
}) => {
  const bubbleMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const dropletMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const ventRingsRef = useRef<THREE.Group | null>(null);
  const startTimeRef = useRef<number>(performance.now());

  const halfCount = Math.ceil(config.maxParticleCount / 2);

  useFrame(() => {
    const bubbleMesh = bubbleMeshRef.current;
    const dropletMesh = dropletMeshRef.current;
    if (!bubbleMesh || !dropletMesh) return;

    const shouldShow = visible && config.isActive;
    bubbleMesh.visible = shouldShow;
    dropletMesh.visible = shouldShow;

    if (!shouldShow) return;

    const elapsedSec = (performance.now() - startTimeRef.current) * 0.001;

    for (let bIdx = 0; bIdx < halfCount; bIdx++) {
      // Even indices = buoyant rising bubbles
      const bubbleTransform = computeDamBaseParticleTransform(bIdx * 2, elapsedSec, config);
      if (!bubbleTransform.visible) {
        _r3fPos.set(0, -100, 0);
        _r3fScale.set(0, 0, 0);
      } else {
        _r3fPos.set(bubbleTransform.x, bubbleTransform.y, bubbleTransform.z);
        _r3fScale.set(bubbleTransform.scaleX, bubbleTransform.scaleY, bubbleTransform.scaleZ);
      }
      _r3fQuat.identity();
      _r3fMatrix.compose(_r3fPos, _r3fQuat, _r3fScale);
      bubbleMesh.setMatrixAt(bIdx, _r3fMatrix);

      // Odd indices = pressurized leaking water droplets
      const dropletTransform = computeDamBaseParticleTransform(bIdx * 2 + 1, elapsedSec, config);
      if (!dropletTransform.visible) {
        _r3fPos.set(0, -100, 0);
        _r3fScale.set(0, 0, 0);
      } else {
        _r3fPos.set(dropletTransform.x, dropletTransform.y, dropletTransform.z);
        _r3fScale.set(dropletTransform.scaleX, dropletTransform.scaleY, dropletTransform.scaleZ);
      }
      _r3fMatrix.compose(_r3fPos, _r3fQuat, _r3fScale);
      dropletMesh.setMatrixAt(bIdx, _r3fMatrix);
    }

    bubbleMesh.instanceMatrix.needsUpdate = true;
    dropletMesh.instanceMatrix.needsUpdate = true;

    // Pulse the 3 dam base emitter vent rings when active
    if (ventRingsRef.current) {
      ventRingsRef.current.children.forEach((child, idx) => {
        const pulse = 0.85 + 0.38 * Math.sin(elapsedSec * 5.2 + idx * 1.1);
        child.scale.set(pulse, pulse, 1);
      });
    }
  });

  const slopeAngleX = -Math.atan2(14.0, 30.0);

  return (
    <group name="R3FDamBaseLeakParticleGroup" visible={visible && config.isActive}>
      {/* Dam Base Emitter Vent Portals along the foundation plinth (y = -8.5, z = 15.4) */}
      <group ref={ventRingsRef}>
        {config.baseEmitterZones.map((zone) => (
          <mesh
            key={zone.id}
            position={[zone.x, zone.y, zone.z + 0.22]}
            rotation={[slopeAngleX, 0, 0]}
          >
            <ringGeometry args={[0.75, 1.45, 24]} />
            <meshBasicMaterial
              color={config.primaryBubbleColorHex}
              transparent
              opacity={0.9}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* 1. R3F InstancedMesh for Buoyant Leaking Water Bubbles */}
      <instancedMesh
        ref={bubbleMeshRef}
        args={[undefined, undefined, halfCount]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.48, 12, 12]} />
        <meshStandardMaterial
          color={config.primaryBubbleColorHex}
          emissive={config.primaryBubbleColorHex}
          emissiveIntensity={0.95}
          roughness={0.12}
          metalness={0.08}
          transparent
          opacity={0.86}
        />
      </instancedMesh>

      {/* 2. R3F InstancedMesh for Pressurized Leaking Water Droplets */}
      <instancedMesh
        ref={dropletMeshRef}
        args={[undefined, undefined, halfCount]}
        frustumCulled={false}
      >
        <dodecahedronGeometry args={[0.38, 0]} />
        <meshStandardMaterial
          color={config.foamDropletColorHex}
          emissive={config.primaryBubbleColorHex}
          emissiveIntensity={1.15}
          roughness={0.18}
          metalness={0.05}
          transparent
          opacity={0.92}
        />
      </instancedMesh>
    </group>
  );
};

interface SharedSceneState {
  explodedRatio: number;
  waterCutaway: boolean;
  showAcousticWaves: boolean;
  showPlume: boolean;
  sensorDistanceM: number;
  hydrostaticHeadM: number;
  orificeDiameterMm: number;
  orificeDeformationState: DamOrificeDeformationState;
  turbineRpm: number;
  signatureClass: AcousticClassId;
  regimeProfile: Dam3DRegimeAnimationProfile;
  pulsePeriodMs: number;
  cameraTransition: {
    targetPos: [number, number, number];
    targetLookAt: [number, number, number];
    progress: number;
  } | null;
}

interface DamProceduralTwinSceneProps {
  stateRef: React.MutableRefObject<SharedSceneState>;
  onHoverPart: (partName: string) => void;
}

/**
 * Full 9-Part Procedural Dam Digital Twin mounted inside @react-three/fiber Canvas
 */
const DamProceduralTwinScene: React.FC<DamProceduralTwinSceneProps> = ({
  stateRef,
  onHoverPart,
}) => {
  const { scene, camera, gl, advance } = useThree();

  const sceneRefs = useRef<{
    controls: OrbitControls;
    canyonGroup: THREE.Group;
    monolithGroup: THREE.Group;
    monolithMesh: THREE.Mesh;
    monolithPosAttr: THREE.BufferAttribute;
    baseMonolithPos: Float32Array;
    lastAppliedOrificeMm: number;
    spillwayGroup: THREE.Group;
    crestGroup: THREE.Group;
    powerhouseGroup: THREE.Group;
    intakeGroup: THREE.Group;
    waterGroup: THREE.Group;
    waterMesh: THREE.Mesh;
    waterPosAttr: THREE.BufferAttribute;
    baseWaterY: Float32Array;
    waterMat: THREE.MeshPhysicalMaterial;
    waterVolumeMesh: THREE.Mesh;
    waterVolumeMat: THREE.MeshStandardMaterial;
    buoyGroup: THREE.Group;
    beaconMat: THREE.MeshStandardMaterial;
    fissureCrackGroup: THREE.Group;
    crackSegmentMeshes: {
      darkMesh: THREE.Mesh;
      glowMesh: THREE.Mesh;
      baseWidth: number;
      baseX: number;
      baseY: number;
      baseZ: number;
      angleZ: number;
    }[];
    crackGlowMat: THREE.MeshStandardMaterial;
    fractureHaloMesh: THREE.Mesh;
    fractureHaloMat: THREE.MeshBasicMaterial;
    fissureJetInstMesh: THREE.InstancedMesh;
    fissureJetCount: number;
    pipingTunnelGroup: THREE.Group;
    tunnelCoreMesh: THREE.Mesh;
    tunnelCoreMat: THREE.MeshStandardMaterial;
    pipingMudInstMesh: THREE.InstancedMesh;
    pipingMudCount: number;
    pipingOriginY: number;
    pipingOriginZ: number;
    cavitationGroup: THREE.Group;
    cavitationShockSpheres: {
      mesh: THREE.Mesh;
      mat: THREE.MeshBasicMaterial;
      center: [number, number, number];
      phaseOffset: number;
    }[];
    cavCenters: [number, number, number][];
    cavBubbleInstMesh: THREE.InstancedMesh;
    cavBubbleCount: number;
    waveRingMeshes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[];
    getUpstreamFaceZ: (y: number) => number;
    startTimeMs: number;
  } | null>(null);

  useEffect(() => {
    // 1. Scene background, fog & studio RoomEnvironment
    scene.background = new THREE.Color(0x0b1526);
    scene.fog = new THREE.FogExp2(0x0b1526, 0.0042);

    const pmremGenerator = new THREE.PMREMGenerator(gl);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.65;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // 2. OrbitControls
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 3, 2);
    controls.enableDamping = !IS_SOFTWARE_GL;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 12;
    controls.maxDistance = 155;
    controls.update();

    const onControlStart = () => {
      stateRef.current.cameraTransition = null;
    };
    controls.addEventListener('start', onControlStart);

    // 3. Studio 3-Point Lighting Rig
    const lightGroup = new THREE.Group();
    scene.add(lightGroup);

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.75);
    hemiLight.position.set(0, 80, 0);
    lightGroup.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    sunLight.position.set(55, 75, 45);
    if (!IS_SOFTWARE_GL) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.width = 2048;
      sunLight.shadow.mapSize.height = 2048;
      sunLight.shadow.camera.near = 10;
      sunLight.shadow.camera.far = 200;
      const d = 55;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.bias = -0.0005;
    }
    lightGroup.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    rimLight.position.set(-50, 35, -40);
    lightGroup.add(rimLight);

    // 4. Procedural Textures & Materials
    const concreteTex = createProceduralConcreteTexture('#94a3b8', '#475569', '#cbd5e1', true);
    const rockTex = createProceduralConcreteTexture('#475569', '#1e293b', '#64748b', false);

    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      map: concreteTex,
      bumpMap: concreteTex,
      bumpScale: 0.15,
      roughness: 0.78,
      metalness: 0.08,
    });

    const darkConcreteMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      map: concreteTex,
      roughness: 0.85,
      metalness: 0.1,
    });

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      map: rockTex,
      bumpMap: rockTex,
      bumpScale: 0.35,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.32,
      metalness: 0.82,
    });

    const penstockMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.28,
      metalness: 0.65,
    });

    const brassSensorMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.35,
      roughness: 0.25,
      metalness: 0.75,
    });

    // 5. Master Scene Hierarchy
    const masterSceneGroup = new THREE.Group();
    scene.add(masterSceneGroup);

    const interactableMeshes: THREE.Object3D[] = [];
    const registerPart = (obj: THREE.Object3D, partLabel: string) => {
      obj.userData.partLabel = partLabel;
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.userData.partLabel = partLabel;
          child.castShadow = !IS_SOFTWARE_GL;
          child.receiveShadow = !IS_SOFTWARE_GL;
          interactableMeshes.push(child);
        }
      });
    };

    // --- PART 1: Canyon Foundation & Abutments ---
    const canyonGroup = new THREE.Group();
    masterSceneGroup.add(canyonGroup);

    const floorGeo = new THREE.BoxGeometry(110, 6, 95);
    const floorMesh = new THREE.Mesh(floorGeo, rockMat);
    floorMesh.position.set(0, -18, 0);
    canyonGroup.add(floorMesh);

    const createCliffWall = (sideSign: number) => {
      const cliffGroup = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const zPos = -34 + i * 17;
        const height = 34 + (i % 2) * 5;
        const width = 18 + (i % 3) * 3;
        const blockGeo = new THREE.DodecahedronGeometry(width * 0.65, 1);
        blockGeo.scale(0.85, height / 14, 1.25);
        const blockMesh = new THREE.Mesh(blockGeo, rockMat);
        blockMesh.position.set(sideSign * (48 + (i % 2) * 3), height * 0.5 - 16, zPos);
        blockMesh.rotation.y = i * 0.6;
        cliffGroup.add(blockMesh);
      }
      return cliffGroup;
    };

    canyonGroup.add(createCliffWall(-1));
    canyonGroup.add(createCliffWall(1));
    registerPart(canyonGroup, 'Granite Canyon Abutments & Foundation Plinth');

    // --- PART 2: Concrete Gravity Dam Monolith (with multi-step extrusion for vertex mesh deformation) ---
    const monolithGroup = new THREE.Group();
    masterSceneGroup.add(monolithGroup);

    const damShape = new THREE.Shape();
    damShape.moveTo(4, -15);
    damShape.lineTo(4, 15);
    damShape.lineTo(-4, 15);
    damShape.lineTo(-18, -15);
    damShape.closePath();

    const damExtrudeSettings: THREE.ExtrudeGeometryOptions = {
      steps: 24,
      depth: 68,
      bevelEnabled: true,
      bevelThickness: 0.4,
      bevelSize: 0.3,
      bevelSegments: 2,
    };

    const damRawGeo = new THREE.ExtrudeGeometry(damShape, damExtrudeSettings);
    damRawGeo.translate(0, 0, -34);
    damRawGeo.rotateY(Math.PI / 2);

    const monolithPosAttr = damRawGeo.attributes.position as THREE.BufferAttribute;
    const baseMonolithPos = new Float32Array(monolithPosAttr.array.length);
    baseMonolithPos.set(monolithPosAttr.array as Float32Array);

    const monolithMesh = new THREE.Mesh(damRawGeo, concreteMat);
    monolithGroup.add(monolithMesh);

    for (let x = -28; x <= 28; x += 8) {
      if (Math.abs(x) < 10) continue;
      const buttressGeo = new THREE.BoxGeometry(1.2, 29, 1.4);
      const buttressMesh = new THREE.Mesh(buttressGeo, darkConcreteMat);
      buttressMesh.position.set(x, -0.5, -10.5);
      buttressMesh.rotation.x = 0.42;
      monolithGroup.add(buttressMesh);
    }
    registerPart(monolithGroup, 'Concrete Gravity Dam Monolith (Block #14)');

    // --- PART 3: Ogee Spillway Chute, Tainter Gates & Stilling Basin ---
    const spillwayGroup = new THREE.Group();
    masterSceneGroup.add(spillwayGroup);

    const chuteGeo = new THREE.BoxGeometry(18, 28, 2.2);
    const chuteMesh = new THREE.Mesh(chuteGeo, darkConcreteMat);
    chuteMesh.position.set(0, -1, -10.2);
    chuteMesh.rotation.x = 0.44;
    spillwayGroup.add(chuteMesh);

    for (let i = -1; i <= 1; i++) {
      const pierGeo = new THREE.BoxGeometry(1.6, 6.5, 9);
      const pierMesh = new THREE.Mesh(pierGeo, concreteMat);
      pierMesh.position.set(i * 6.5, 16.5, 0);
      spillwayGroup.add(pierMesh);
    }

    for (let i = -0.5; i <= 0.5; i += 1) {
      const gateGeo = new THREE.CylinderGeometry(3.2, 3.2, 4.8, 16, 1, true, 0, Math.PI * 0.65);
      const gateMesh = new THREE.Mesh(gateGeo, steelMat);
      gateMesh.rotation.z = Math.PI / 2;
      gateMesh.position.set(i * 6.5, 15.2, 1.2);
      spillwayGroup.add(gateMesh);
    }

    const basinFloorGeo = new THREE.BoxGeometry(22, 1.5, 18);
    const basinFloorMesh = new THREE.Mesh(basinFloorGeo, darkConcreteMat);
    basinFloorMesh.position.set(0, -14.5, -24);
    spillwayGroup.add(basinFloorMesh);

    for (let bx = -7; bx <= 7; bx += 3.5) {
      const baffleGeo = new THREE.BoxGeometry(1.4, 2.2, 2.2);
      const baffleMesh = new THREE.Mesh(baffleGeo, concreteMat);
      baffleMesh.position.set(bx, -13.2, -23);
      spillwayGroup.add(baffleMesh);
    }
    registerPart(spillwayGroup, 'Ogee Spillway Chute, Tainter Gates & Stilling Basin');

    // --- PART 4: Crest Roadway Deck, Gantry Crane & Parapet Rails ---
    const crestGroup = new THREE.Group();
    masterSceneGroup.add(crestGroup);

    const deckGeo = new THREE.BoxGeometry(70, 1.4, 9.2);
    const deckMesh = new THREE.Mesh(deckGeo, darkConcreteMat);
    deckMesh.position.set(0, 15.6, 0);
    crestGroup.add(deckMesh);

    for (const zRail of [-4.2, 4.2]) {
      const railGeo = new THREE.BoxGeometry(70, 1.1, 0.35);
      const railMesh = new THREE.Mesh(railGeo, steelMat);
      railMesh.position.set(0, 16.6, zRail);
      crestGroup.add(railMesh);
    }

    const gantryGroup = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(0.9, 6.5, 0.9);
    for (const lx of [-3.5, 3.5]) {
      for (const lz of [-3.2, 3.2]) {
        const leg = new THREE.Mesh(legGeo, brassSensorMat);
        leg.position.set(lx, 19.2, lz);
        gantryGroup.add(leg);
      }
    }
    const beamGeo = new THREE.BoxGeometry(8.5, 1.4, 7.6);
    const beam = new THREE.Mesh(beamGeo, brassSensorMat);
    beam.position.set(0, 22.8, 0);
    gantryGroup.add(beam);
    gantryGroup.position.set(-18, 0, 0);
    crestGroup.add(gantryGroup);
    registerPart(crestGroup, 'Crest Roadway Deck & Intake Gantry Crane');

    // --- PART 5: Hydroelectric Powerhouse & Steel Penstocks ---
    const powerhouseGroup = new THREE.Group();
    masterSceneGroup.add(powerhouseGroup);

    const hallGeo = new THREE.BoxGeometry(22, 11, 14);
    const hallMesh = new THREE.Mesh(hallGeo, concreteMat);
    hallMesh.position.set(19, -9.5, -22);
    powerhouseGroup.add(hallMesh);

    const roofGeo = new THREE.BoxGeometry(23, 1.0, 15);
    const roofMesh = new THREE.Mesh(roofGeo, steelMat);
    roofMesh.position.set(19, -3.8, -22);
    powerhouseGroup.add(roofMesh);

    for (let i = 0; i < 3; i++) {
      const genX = 13 + i * 6;
      const genGeo = new THREE.CylinderGeometry(1.9, 2.1, 2.6, 20);
      const genMesh = new THREE.Mesh(genGeo, penstockMat);
      genMesh.position.set(genX, -2.2, -22);
      powerhouseGroup.add(genMesh);

      const capGeo = new THREE.CylinderGeometry(1.2, 1.9, 0.8, 20);
      const capMesh = new THREE.Mesh(capGeo, brassSensorMat);
      capMesh.position.set(genX, -0.5, -22);
      powerhouseGroup.add(capMesh);

      const penstockCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(genX, 4, 2),
        new THREE.Vector3(genX, -1, -7),
        new THREE.Vector3(genX, -8, -16),
      ]);
      const pipeGeo = new THREE.TubeGeometry(penstockCurve, 20, 1.15, 16, false);
      const pipeMesh = new THREE.Mesh(pipeGeo, penstockMat);
      powerhouseGroup.add(pipeMesh);
    }
    registerPart(powerhouseGroup, 'Downstream Hydroelectric Powerhouse & Steel Penstocks');

    // --- PART 6: Upstream Intake Tower & Trash Racks ---
    const intakeGroup = new THREE.Group();
    masterSceneGroup.add(intakeGroup);

    const towerGeo = new THREE.BoxGeometry(16, 31, 6);
    const towerMesh = new THREE.Mesh(towerGeo, concreteMat);
    towerMesh.position.set(18, 0.5, 7);
    intakeGroup.add(towerMesh);

    for (let i = 0; i < 3; i++) {
      const rackGeo = new THREE.BoxGeometry(3.4, 18, 0.5);
      const rackMesh = new THREE.Mesh(rackGeo, steelMat);
      rackMesh.position.set(13 + i * 5, -2, 10.2);
      intakeGroup.add(rackMesh);
    }
    registerPart(intakeGroup, 'Upstream Intake Tower & Trash Rack Screens');

    // --- PART 7: Upstream Reservoir Water & Downstream Tailrace ---
    const waterGroup = new THREE.Group();
    masterSceneGroup.add(waterGroup);

    const waterGeo = new THREE.PlaneGeometry(68, 34, 40, 24);
    waterGeo.rotateX(-Math.PI / 2);

    const waterPosAttr = waterGeo.attributes.position as THREE.BufferAttribute;
    const baseWaterY = new Float32Array(waterPosAttr.count);
    for (let i = 0; i < waterPosAttr.count; i++) {
      baseWaterY[i] = waterPosAttr.getY(i);
    }

    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.18,
      roughness: 0.14,
      metalness: 0.1,
      transmission: IS_SOFTWARE_GL ? 0 : 0.55,
      transparent: true,
      opacity: 0.72,
      ior: 1.333,
    });

    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(0, 8.5, 21);
    waterGroup.add(waterMesh);

    const waterVolumeGeo = new THREE.BoxGeometry(68, 22, 34);
    const waterVolumeMat = new THREE.MeshStandardMaterial({
      color: 0x0369a1,
      roughness: 0.4,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const waterVolumeMesh = new THREE.Mesh(waterVolumeGeo, waterVolumeMat);
    waterVolumeMesh.position.set(0, -3.0, 21);
    waterGroup.add(waterVolumeMesh);

    const tailraceGeo = new THREE.PlaneGeometry(58, 24, 16, 12);
    tailraceGeo.rotateX(-Math.PI / 2);
    const tailraceMesh = new THREE.Mesh(tailraceGeo, waterMat);
    tailraceMesh.position.set(6, -13.2, -33);
    waterGroup.add(tailraceMesh);
    registerPart(waterGroup, 'Upstream Reservoir Water Body & Tailrace');

    // --- PART 8: Hydrophone Sensor Array & Multi-Regime 3D Acoustic Anomaly Visualizer ---
    const acousticLeakGroup = new THREE.Group();
    masterSceneGroup.add(acousticLeakGroup);

    const buoyGroup = new THREE.Group();
    const floatGeo = new THREE.CylinderGeometry(1.6, 1.2, 1.2, 20);
    const floatMesh = new THREE.Mesh(floatGeo, brassSensorMat);
    floatMesh.position.y = 0.6;
    buoyGroup.add(floatMesh);

    const mastGeo = new THREE.CylinderGeometry(0.15, 0.15, 3.2, 8);
    const mastMesh = new THREE.Mesh(mastGeo, steelMat);
    mastMesh.position.y = 2.4;
    buoyGroup.add(mastMesh);

    const beaconGeo = new THREE.SphereGeometry(0.48, 16, 16);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.8,
    });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.position.y = 4.1;
    buoyGroup.add(beaconMesh);

    const cableGeo = new THREE.CylinderGeometry(0.08, 0.08, 16, 8);
    const cableMesh = new THREE.Mesh(cableGeo, steelMat);
    cableMesh.position.y = -8;
    buoyGroup.add(cableMesh);

    const podGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.8, 16);
    const podMesh = new THREE.Mesh(podGeo, brassSensorMat);
    podMesh.position.y = -15.5;
    buoyGroup.add(podMesh);

    buoyGroup.position.set(-2, 9.0, 14);
    acousticLeakGroup.add(buoyGroup);

    const getUpstreamFaceZ = (y: number) => 4.35 + ((15 - y) / 30) * 14.0;
    const damFaceSlopeAngleX = -Math.atan2(14.0, 30.0);

    const hNodePositions: [number, number, number][] = [
      [-14, 9, getUpstreamFaceZ(9) + 0.35],
      [-2, 8, getUpstreamFaceZ(8) + 0.35],
      [-2, -2, getUpstreamFaceZ(-2) + 0.35],
      [0, -13, -16],
    ];
    hNodePositions.forEach(([hx, hy, hz]) => {
      const nodeGeo = new THREE.SphereGeometry(0.65, 16, 16);
      const nodeMesh = new THREE.Mesh(nodeGeo, brassSensorMat);
      nodeMesh.position.set(hx, hy, hz);
      acousticLeakGroup.add(nodeMesh);
    });

    // REGIME 1: HAIRLINE FISSURE CRACK & HIGH-PRESSURE JET (`hairline_fissure`)
    const fissureCrackGroup = new THREE.Group();
    acousticLeakGroup.add(fissureCrackGroup);

    const crackSegmentsData = [
      { x: -3.2, y: 12.6, len: 3.4, width: 0.42, angleZ: 0.18 },
      { x: -3.6, y: 9.8, len: 3.6, width: 0.52, angleZ: -0.24 },
      { x: -2.9, y: 6.9, len: 3.8, width: 0.58, angleZ: 0.22 },
      { x: -3.5, y: 3.8, len: 4.0, width: 0.56, angleZ: -0.19 },
      { x: -2.8, y: 0.8, len: 3.8, width: 0.48, angleZ: 0.21 },
      { x: -3.3, y: -2.0, len: 3.4, width: 0.40, angleZ: -0.15 },
      { x: -5.4, y: 8.4, len: 3.5, width: 0.36, angleZ: 0.72 },
      { x: -1.1, y: 5.5, len: 3.6, width: 0.38, angleZ: -0.68 },
      { x: -5.2, y: 2.4, len: 3.2, width: 0.34, angleZ: 0.64 },
    ];

    const crackCoreMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.95,
    });

    const crackGlowMat = new THREE.MeshStandardMaterial({
      color: 0xff3b3b,
      emissive: 0xef4444,
      emissiveIntensity: 2.8,
      transparent: true,
      opacity: 0.98,
    });

    const crackSegmentMeshes: {
      darkMesh: THREE.Mesh;
      glowMesh: THREE.Mesh;
      baseWidth: number;
      baseX: number;
      baseY: number;
      baseZ: number;
      angleZ: number;
    }[] = [];

    crackSegmentsData.forEach((seg) => {
      const zSurf = getUpstreamFaceZ(seg.y);
      const darkGeo = new THREE.BoxGeometry(seg.width * 1.5, seg.len, 0.45);
      const darkMesh = new THREE.Mesh(darkGeo, crackCoreMat);
      darkMesh.position.set(seg.x, seg.y, zSurf + 0.12);
      darkMesh.rotation.set(damFaceSlopeAngleX, 0, seg.angleZ);
      fissureCrackGroup.add(darkMesh);

      const glowGeo = new THREE.BoxGeometry(seg.width * 0.82, seg.len * 0.96, 0.52);
      const glowMesh = new THREE.Mesh(glowGeo, crackGlowMat);
      glowMesh.position.set(seg.x, seg.y, zSurf + 0.22);
      glowMesh.rotation.set(damFaceSlopeAngleX, 0, seg.angleZ);
      fissureCrackGroup.add(glowMesh);

      crackSegmentMeshes.push({
        darkMesh,
        glowMesh,
        baseWidth: seg.width,
        baseX: seg.x,
        baseY: seg.y,
        baseZ: zSurf,
        angleZ: seg.angleZ,
      });
    });

    const fractureHaloGeo = new THREE.RingGeometry(2.2, 2.9, 32);
    const fractureHaloMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const fractureHaloMesh = new THREE.Mesh(fractureHaloGeo, fractureHaloMat);
    fractureHaloMesh.position.set(-3.2, 6.8, getUpstreamFaceZ(6.8) + 0.38);
    fractureHaloMesh.rotation.x = damFaceSlopeAngleX;
    fissureCrackGroup.add(fractureHaloMesh);

    const fissureJetCount = 90;
    const fissureJetGeo = new THREE.SphereGeometry(0.28, 8, 8);
    const fissureJetMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.35,
      transparent: true,
      opacity: 0.92,
    });
    const fissureJetInstMesh = new THREE.InstancedMesh(
      fissureJetGeo,
      fissureJetMat,
      fissureJetCount
    );
    fissureJetInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fissureJetInstMesh.frustumCulled = false;
    fissureCrackGroup.add(fissureJetInstMesh);

    // REGIME 2: FOUNDATION PIPING SEEPAGE & MUD EROSION (`internal_piping`)
    const pipingTunnelGroup = new THREE.Group();
    acousticLeakGroup.add(pipingTunnelGroup);

    const pipingOriginY = -5.5;
    const pipingOriginZ = getUpstreamFaceZ(pipingOriginY);

    const tunnelOuterGeo = new THREE.CylinderGeometry(2.6, 3.1, 1.6, 24);
    tunnelOuterGeo.rotateX(Math.PI / 2);
    const tunnelOuterMat = new THREE.MeshStandardMaterial({
      color: 0x451a03,
      emissive: 0x78350f,
      emissiveIntensity: 0.75,
      roughness: 0.95,
    });
    const tunnelOuterMesh = new THREE.Mesh(tunnelOuterGeo, tunnelOuterMat);
    tunnelOuterMesh.position.set(-5.0, pipingOriginY, pipingOriginZ + 0.15);
    tunnelOuterMesh.rotation.x = damFaceSlopeAngleX;
    pipingTunnelGroup.add(tunnelOuterMesh);

    const tunnelCoreGeo = new THREE.CylinderGeometry(1.6, 2.0, 1.8, 20);
    tunnelCoreGeo.rotateX(Math.PI / 2);
    const tunnelCoreMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 1.9,
      roughness: 0.65,
    });
    const tunnelCoreMesh = new THREE.Mesh(tunnelCoreGeo, tunnelCoreMat);
    tunnelCoreMesh.position.set(-5.0, pipingOriginY, pipingOriginZ + 0.28);
    tunnelCoreMesh.rotation.x = damFaceSlopeAngleX;
    pipingTunnelGroup.add(tunnelCoreMesh);

    const pipingMudCount = 85;
    const pipingMudGeo = new THREE.DodecahedronGeometry(0.42, 0);
    const pipingMudMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.85,
      roughness: 0.82,
      transparent: true,
      opacity: 0.92,
    });
    const pipingMudInstMesh = new THREE.InstancedMesh(
      pipingMudGeo,
      pipingMudMat,
      pipingMudCount
    );
    pipingMudInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pipingMudInstMesh.frustumCulled = false;
    pipingTunnelGroup.add(pipingMudInstMesh);

    // REGIME 3: ULTRASONIC CAVITATION IMPLOSION SHOCKWAVES (`cavitation_burst`)
    const cavitationGroup = new THREE.Group();
    acousticLeakGroup.add(cavitationGroup);

    const cavitationShockSpheres: {
      mesh: THREE.Mesh;
      mat: THREE.MeshBasicMaterial;
      center: [number, number, number];
      phaseOffset: number;
    }[] = [];

    const cavCenters: [number, number, number][] = [
      [13.0, -2.5, 11.2],
      [18.0, -4.0, 11.2],
      [23.0, -1.5, 11.2],
      [18.0, 3.0, 11.2],
    ];

    cavCenters.forEach((center, idx) => {
      const shockGeo = new THREE.SphereGeometry(1.0, 20, 16);
      const shockMat = new THREE.MeshBasicMaterial({
        color: idx % 2 === 0 ? 0xf43f5e : 0xe879f9,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      });
      const shockMesh = new THREE.Mesh(shockGeo, shockMat);
      shockMesh.position.set(center[0], center[1], center[2]);
      cavitationGroup.add(shockMesh);
      cavitationShockSpheres.push({
        mesh: shockMesh,
        mat: shockMat,
        center,
        phaseOffset: idx * 0.25,
      });
    });

    const cavBubbleCount = 80;
    const cavBubbleGeo = new THREE.SphereGeometry(0.26, 10, 10);
    const cavBubbleMat = new THREE.MeshStandardMaterial({
      color: 0xfda4af,
      emissive: 0xf43f5e,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.9,
    });
    const cavBubbleInstMesh = new THREE.InstancedMesh(
      cavBubbleGeo,
      cavBubbleMat,
      cavBubbleCount
    );
    cavBubbleInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cavBubbleInstMesh.frustumCulled = false;
    cavitationGroup.add(cavBubbleInstMesh);

    // SHARED CONCENTRIC 3D ACOUSTIC WAVEFRONT RINGS
    const waveRingMeshes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
    for (let r = 0; r < 4; r++) {
      const ringGeo = new THREE.TorusGeometry(1.0, 0.12, 12, 48);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(-3, 5, 9.5);
      acousticLeakGroup.add(ringMesh);
      waveRingMeshes.push({ mesh: ringMesh, mat: ringMat });
    }

    registerPart(
      acousticLeakGroup,
      'Hydrophone Sensor Buoy, 4-Node Array & Multi-Regime 3D Anomaly Visualizer'
    );

    // 6. Raycaster for Hover Part Inspection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerMove = (e: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(interactableMeshes, false);
      if (intersects.length > 0) {
        const hit = intersects[0].object;
        if (hit.userData.partLabel) {
          onHoverPart(hit.userData.partLabel);
        }
      }
    };
    gl.domElement.addEventListener('mousemove', onPointerMove);

    sceneRefs.current = {
      controls,
      canyonGroup,
      monolithGroup,
      monolithMesh,
      monolithPosAttr,
      baseMonolithPos,
      lastAppliedOrificeMm: -1,
      spillwayGroup,
      crestGroup,
      powerhouseGroup,
      intakeGroup,
      waterGroup,
      waterMesh,
      waterPosAttr,
      baseWaterY,
      waterMat,
      waterVolumeMesh,
      waterVolumeMat,
      buoyGroup,
      beaconMat,
      fissureCrackGroup,
      crackSegmentMeshes,
      crackGlowMat,
      fractureHaloMesh,
      fractureHaloMat,
      fissureJetInstMesh,
      fissureJetCount,
      pipingTunnelGroup,
      tunnelCoreMesh,
      tunnelCoreMat,
      pipingMudInstMesh,
      pipingMudCount,
      pipingOriginY,
      pipingOriginZ,
      cavitationGroup,
      cavitationShockSpheres,
      cavCenters,
      cavBubbleInstMesh,
      cavBubbleCount,
      waveRingMeshes,
      getUpstreamFaceZ,
      startTimeMs: performance.now(),
    };

    // Start software-WebGL paced loop ONLY after scene, lights, and textures are fully initialized
    let disposed = false;
    let timerId = 0;
    if (IS_SOFTWARE_GL) {
      const rawGl = gl.getContext() as WebGL2RenderingContext;
      const afterDraw = (cb: () => void) => {
        if (typeof rawGl.fenceSync === 'function') {
          const sync = rawGl.fenceSync(rawGl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          rawGl.flush();
          const poll = () => {
            if (disposed) return;
            if (!sync) {
              timerId = window.setTimeout(cb, 80);
              return;
            }
            const state = rawGl.getSyncParameter(sync, rawGl.SYNC_STATUS);
            if (state === rawGl.UNSIGNALED) {
              timerId = window.setTimeout(poll, 5);
            } else {
              rawGl.deleteSync(sync);
              timerId = window.setTimeout(cb, 80);
            }
          };
          timerId = window.setTimeout(poll, 5);
        } else {
          rawGl.finish();
          timerId = window.setTimeout(cb, 80);
        }
      };

      const step = () => {
        if (disposed) return;
        advance(performance.now());
        afterDraw(step);
      };

      advance(performance.now());
      afterDraw(step);
    }

    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      gl.domElement.removeEventListener('mousemove', onPointerMove);
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      envTarget.dispose();
      concreteTex.dispose();
      rockTex.dispose();
      scene.remove(lightGroup);
      scene.remove(masterSceneGroup);
    };
  }, [scene, camera, gl, advance, onHoverPart, stateRef]);

  useFrame(() => {
    const refs = sceneRefs.current;
    if (!refs) return;

    const elapsedSec = (performance.now() - refs.startTimeMs) * 0.001;
    const st = stateRef.current;
    const profile = st.regimeProfile;
    const deformState = st.orificeDeformationState;

    // A. Smooth Camera Preset Transition
    if (st.cameraTransition) {
      st.cameraTransition.progress = Math.min(1, st.cameraTransition.progress + 0.06);
      const alpha = 1 - Math.pow(1 - st.cameraTransition.progress, 3);
      _camPosVec3.set(...st.cameraTransition.targetPos);
      _targetVec3.set(...st.cameraTransition.targetLookAt);
      camera.position.lerp(_camPosVec3, alpha * 0.25);
      refs.controls.target.lerp(_targetVec3, alpha * 0.25);
      if (st.cameraTransition.progress >= 0.99) {
        st.cameraTransition = null;
      }
    }
    refs.controls.update();

    // B. Conditional 3D Monolith Vertex Mesh Deformation when `orificeDiameterMm > 15mm`
    if (refs.lastAppliedOrificeMm !== st.orificeDiameterMm) {
      refs.lastAppliedOrificeMm = st.orificeDiameterMm;
      const posAttr = refs.monolithPosAttr;
      const baseArr = refs.baseMonolithPos;
      const vertCount = posAttr.count;

      if (!deformState.isDeformed) {
        // Restore exact undeformed concrete monolith mesh vertices when orificeDiameterMm <= 15mm
        for (let i = 0; i < vertCount; i++) {
          const idx3 = i * 3;
          posAttr.setXYZ(i, baseArr[idx3], baseArr[idx3 + 1], baseArr[idx3 + 2]);
        }
      } else {
        // Displace concrete monolith vertices along the Block #14 fracture zone when orificeDiameterMm > 15mm
        for (let i = 0; i < vertCount; i++) {
          const idx3 = i * 3;
          const bx = baseArr[idx3];
          const by = baseArr[idx3 + 1];
          const bz = baseArr[idx3 + 2];
          const { dx, dy, dz } = computeMonolithVertexDeformationOffset(bx, by, bz, deformState);
          posAttr.setXYZ(i, bx + dx, by + dy, bz + dz);
        }
      }
      posAttr.needsUpdate = true;
      refs.monolithMesh.geometry.computeVertexNormals();
    }

    // C. Exploded Structural Inspection Offsets + Structural Micro-Tremor
    const exp = st.explodedRatio;
    const tremor =
      profile.structuralTremorAmplitude +
      (deformState.isDeformed ? 0.08 * deformState.normalizedSeverity : 0);
    const fissureTremorX =
      st.signatureClass === 'hairline_fissure' || deformState.isDeformed
        ? Math.sin(elapsedSec * 48) * tremor * 1.4
        : 0;
    const cavTremorX =
      st.signatureClass === 'cavitation_burst'
        ? Math.sin(elapsedSec * 62) * tremor * 1.8
        : 0;

    refs.canyonGroup.position.y = THREE.MathUtils.lerp(refs.canyonGroup.position.y, -exp * 10, 0.1);
    refs.monolithGroup.position.x = fissureTremorX;
    refs.crestGroup.position.y = THREE.MathUtils.lerp(refs.crestGroup.position.y, exp * 14, 0.1);
    refs.spillwayGroup.position.z = THREE.MathUtils.lerp(refs.spillwayGroup.position.z, -exp * 14, 0.1);
    refs.powerhouseGroup.position.z = THREE.MathUtils.lerp(refs.powerhouseGroup.position.z, -exp * 22, 0.1);
    refs.powerhouseGroup.position.x = THREE.MathUtils.lerp(
      refs.powerhouseGroup.position.x,
      exp * 8 + cavTremorX,
      0.2
    );
    refs.intakeGroup.position.z = THREE.MathUtils.lerp(refs.intakeGroup.position.z, exp * 12, 0.1);
    refs.intakeGroup.position.x = cavTremorX;
    refs.waterGroup.position.z = THREE.MathUtils.lerp(refs.waterGroup.position.z, exp * 18, 0.1);

    // D. Reservoir Water Level & Wave Ripple
    const headNormalized = Math.max(0, Math.min(1, (st.hydrostaticHeadM - 20) / 130));
    const targetWaterSurfaceY = -2 + headNormalized * 14.5;
    refs.waterMesh.position.y = THREE.MathUtils.lerp(refs.waterMesh.position.y, targetWaterSurfaceY, 0.08);
    refs.waterVolumeMesh.scale.y = Math.max(0.2, 0.35 + headNormalized * 0.75);
    refs.waterVolumeMesh.position.y = refs.waterMesh.position.y - 11 * refs.waterVolumeMesh.scale.y;

    const waveAmp = st.signatureClass === 'normal_ambient' && !deformState.isDeformed ? 0.18 : 0.32;
    for (let i = 0; i < refs.waterPosAttr.count; i++) {
      const vx = refs.waterPosAttr.getX(i);
      const vz = refs.waterPosAttr.getZ(i);
      const wave =
        Math.sin(vx * 0.18 + elapsedSec * 2.2) * waveAmp +
        Math.cos(vz * 0.24 + elapsedSec * 1.7) * (waveAmp * 0.75);
      refs.waterPosAttr.setY(i, refs.baseWaterY[i] + wave);
    }
    refs.waterPosAttr.needsUpdate = true;

    const targetOpacity = st.waterCutaway ? 0.16 : 0.72;
    refs.waterMat.opacity = THREE.MathUtils.lerp(refs.waterMat.opacity, targetOpacity, 0.1);
    refs.waterVolumeMat.opacity = THREE.MathUtils.lerp(
      refs.waterVolumeMat.opacity,
      st.waterCutaway ? 0.05 : 0.26,
      0.1
    );

    // E. Hydrophone Buoy Position & Danger Beacon
    const distNorm = Math.max(0, Math.min(1, (st.sensorDistanceM - 5) / 115));
    const targetBuoyZ = 7.5 + distNorm * 28;
    refs.buoyGroup.position.z = THREE.MathUtils.lerp(refs.buoyGroup.position.z, targetBuoyZ, 0.08);
    refs.buoyGroup.position.y = refs.waterMesh.position.y + Math.sin(elapsedSec * 2.4) * 0.25;
    refs.buoyGroup.rotation.z = Math.sin(elapsedSec * 1.8) * 0.05;

    refs.beaconMat.color.setHex(deformState.isDeformed ? 0xef4444 : profile.buoyBeaconColorHex);
    refs.beaconMat.emissive.setHex(deformState.isDeformed ? 0xef4444 : profile.buoyBeaconColorHex);
    const strobeSpeed = profile.isDanger || deformState.isDeformed ? 9.0 : 2.5;
    refs.beaconMat.emissiveIntensity =
      1.1 + 1.4 * (0.5 + 0.5 * Math.sin(elapsedSec * strobeSpeed));

    // F. Regime-Specific 3D Animations
    const isFissure = st.signatureClass === 'hairline_fissure';
    const isPiping = st.signatureClass === 'internal_piping';
    const isCavitation = st.signatureClass === 'cavitation_burst';

    // 1. Hairline Fissure Crack & High-Pressure Jet (also activated when orificeDiameterMm > 15mm)
    refs.fissureCrackGroup.visible =
      st.showPlume && (isFissure || isCavitation || deformState.isDeformed);
    if (refs.fissureCrackGroup.visible) {
      const crackScale = Math.max(
        deformState.isDeformed ? 1.65 + deformState.normalizedSeverity * 1.4 : 0.35,
        profile.crackWidthScale
      );
      const pulseHz = Math.max(1.2, profile.crackPulseSpeedHz);

      refs.crackSegmentMeshes.forEach((seg, idx) => {
        const pulseWave = 0.5 + 0.5 * Math.sin(elapsedSec * pulseHz * Math.PI * 2 - idx * 0.55);
        const widthFactor = crackScale * (0.9 + 0.65 * pulseWave);
        seg.darkMesh.scale.set(widthFactor, 1.0 + 0.08 * pulseWave, 1.0);
        seg.glowMesh.scale.set(widthFactor * 1.2, 1.0 + 0.12 * pulseWave, 1.0);
        seg.glowMesh.position.z = seg.baseZ + 0.24 + 0.08 * pulseWave;
      });

      refs.crackGlowMat.color.setHex(isFissure || deformState.isDeformed ? 0xff3b3b : 0xf43f5e);
      refs.crackGlowMat.emissive.setHex(isFissure || deformState.isDeformed ? 0xef4444 : 0xe879f9);
      refs.crackGlowMat.emissiveIntensity =
        1.8 + 1.8 * (0.5 + 0.5 * Math.sin(elapsedSec * pulseHz * Math.PI * 2));

      const haloPhase = (elapsedSec * 1.5) % 1.0;
      const haloScale = 0.75 + 0.85 * haloPhase;
      refs.fractureHaloMesh.scale.set(haloScale, haloScale, 1);
      refs.fractureHaloMat.opacity = (1.0 - haloPhase) * 0.9;

      const jetSpeed = Math.max(0.6, profile.crackJetVelocityRatio) * 1.4;
      for (let i = 0; i < refs.fissureJetCount; i++) {
        const cycle = (elapsedSec * jetSpeed + i * (1 / refs.fissureJetCount)) % 1.0;
        const seedY = 0.5 + ((i * 17) % 120) * 0.1;
        const seedZ = refs.getUpstreamFaceZ(seedY) + 0.35;
        const bx = -3.2 + Math.sin(i * 3.7 + elapsedSec * 6.0) * (0.3 + cycle * 2.4);
        const by = seedY + cycle * 4.2 - cycle * cycle * 3.8;
        const bz = seedZ + cycle * (isFissure || deformState.isDeformed ? 14.5 : 6.5);
        const bScale = (1 - cycle * 0.4) * (0.65 + (i % 4) * 0.25);

        _vec3.set(bx, by, bz);
        _scaleVec3.set(bScale, bScale, bScale * 1.75);
        _quat.identity();
        _matrix.compose(_vec3, _quat, _scaleVec3);
        refs.fissureJetInstMesh.setMatrixAt(i, _matrix);
      }
      refs.fissureJetInstMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. Foundation Piping Seepage & Muddy Sediment Plume
    refs.pipingTunnelGroup.visible = st.showPlume && isPiping;
    if (refs.pipingTunnelGroup.visible) {
      const mudIntensity = Math.max(0.7, profile.pipingSedimentIntensity);
      const boilPulse = 0.9 + 0.32 * Math.sin(elapsedSec * 5.5);
      refs.tunnelCoreMesh.scale.set(boilPulse, 1, boilPulse);
      refs.tunnelCoreMat.emissiveIntensity = 1.3 + 1.0 * Math.sin(elapsedSec * 6.0);

      for (let i = 0; i < refs.pipingMudCount; i++) {
        const cycle = (elapsedSec * (0.55 * mudIntensity) + i * (1 / refs.pipingMudCount)) % 1.0;
        const swirlAngle = elapsedSec * 2.8 + i * 1.3;
        const radius = 0.8 + cycle * 5.6 * mudIntensity;
        const mx = -5.0 + Math.cos(swirlAngle) * radius;
        const my = refs.pipingOriginY + cycle * 15.5;
        const mz =
          refs.pipingOriginZ + 0.5 + Math.sin(swirlAngle) * (0.9 + cycle * 5.5) + cycle * 6.5;
        const mScale = (0.6 + Math.sin(cycle * Math.PI) * 1.05) * (0.65 + (i % 3) * 0.28);

        _vec3.set(mx, my, mz);
        _euler.set(elapsedSec * 2.2 + i, elapsedSec * 1.7, i);
        _quat.setFromEuler(_euler);
        _scaleVec3.set(mScale, mScale, mScale);
        _matrix.compose(_vec3, _quat, _scaleVec3);
        refs.pipingMudInstMesh.setMatrixAt(i, _matrix);
      }
      refs.pipingMudInstMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Ultrasonic Cavitation Implosion Shockwaves
    refs.cavitationGroup.visible = st.showPlume && isCavitation;
    if (refs.cavitationGroup.visible) {
      const shockHz = Math.max(2.5, profile.cavitationShockRateHz);
      refs.cavitationShockSpheres.forEach((sphere) => {
        const rawPhase = (elapsedSec * (shockHz * 0.45) + sphere.phaseOffset) % 1.0;
        const implosionRadius =
          rawPhase < 0.75
            ? 0.4 + (rawPhase / 0.75) * 3.2
            : Math.max(0.15, 3.6 * (1.0 - (rawPhase - 0.75) / 0.25));
        sphere.mesh.scale.setScalar(implosionRadius);
        sphere.mesh.rotation.y = elapsedSec * 3.2;
        sphere.mesh.rotation.x = elapsedSec * 2.1;
        sphere.mat.opacity = rawPhase > 0.7 ? 0.95 : (1.0 - rawPhase * 0.6) * 0.75;
      });

      for (let i = 0; i < refs.cavBubbleCount; i++) {
        const cycle = (elapsedSec * 2.4 + i * (1 / refs.cavBubbleCount)) % 1.0;
        const portalIdx = i % refs.cavCenters.length;
        const [cx, cy, cz] = refs.cavCenters[portalIdx];
        const jitterX = cx + Math.sin(i * 7.1 + elapsedSec * 14) * (0.5 + cycle * 2.6);
        const jitterY = cy + Math.cos(i * 5.3 + elapsedSec * 12) * (0.5 + cycle * 2.6);
        const jitterZ = cz + cycle * 4.8;
        const popScale = cycle < 0.82 ? 0.4 + cycle * 1.1 : (1.0 - cycle) * 4.5;

        _vec3.set(jitterX, jitterY, jitterZ);
        _quat.identity();
        _scaleVec3.setScalar(Math.max(0.05, popScale));
        _matrix.compose(_vec3, _quat, _scaleVec3);
        refs.cavBubbleInstMesh.setMatrixAt(i, _matrix);
      }
      refs.cavBubbleInstMesh.instanceMatrix.needsUpdate = true;
    }

    // G. Concentric 3D Acoustic Wavefront Rings
    const periodSec = Math.max(0.45, st.pulsePeriodMs / 1000);
    const originX = isCavitation ? 18.0 : isPiping ? -5.0 : isFissure || deformState.isDeformed ? -3.2 : 0.0;
    const originY = isCavitation
      ? -1.0
      : isPiping
      ? refs.pipingOriginY + 2.0
      : isFissure || deformState.isDeformed
      ? 5.5
      : refs.waterMesh.position.y - 1.5;
    const originZ = isCavitation
      ? 11.5
      : isPiping
      ? refs.pipingOriginZ + 1.5
      : isFissure || deformState.isDeformed
      ? refs.getUpstreamFaceZ(5.5) + 1.0
      : 10.0;

    for (let r = 0; r < refs.waveRingMeshes.length; r++) {
      const { mesh, mat } = refs.waveRingMeshes[r];
      mesh.visible = st.showAcousticWaves;
      if (st.showAcousticWaves) {
        const phase = ((elapsedSec / periodSec) + r / refs.waveRingMeshes.length) % 1.0;
        const radius = 1.5 + phase * (profile.isDanger || deformState.isDeformed ? 26.0 : 18.0);
        mesh.scale.set(radius, 1, radius);
        mesh.position.set(originX, originY, originZ);
        mat.color.setHex(deformState.isDeformed ? 0xef4444 : profile.waveColorHex);
        mat.opacity = Math.max(
          0.04,
          (1 - phase) * (profile.isDanger || deformState.isDeformed ? 0.82 : 0.5)
        );
      }
    }
  });

  return null;
};

export const Dam3DSceneView: React.FC<Dam3DSceneViewProps> = ({
  params,
  onUpdateParam,
  onSelectPreset,
  leakProbability,
}) => {
  // Interactive 3D Viewport UI state
  const [explodedRatio, setExplodedRatio] = useState<number>(0);
  const [waterCutaway, setWaterCutaway] = useState<boolean>(false);
  const [showAcousticWaves, setShowAcousticWaves] = useState<boolean>(true);
  const [showPlume, setShowPlume] = useState<boolean>(true);
  const [activeCameraPreset, setActiveCameraPreset] = useState<CameraPresetId>('overview');
  const [hoveredPartName, setHoveredPartName] = useState<string>('Concrete Gravity Monolith');
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);

  const regimeProfile = useMemo(() => getDam3DRegimeAnimationProfile(params), [params]);
  const baseLeakParticleConfig = useMemo(
    () => calculateDamBaseLeakParticleConfig(params, leakProbability),
    [params, leakProbability]
  );
  const orificeDeformationState = useMemo(
    () => calculateDamOrificeDeformationState(params.orificeDiameterMm),
    [params.orificeDiameterMm]
  );

  // Mutable ref read inside the R3F useFrame loop
  const stateRef = useRef<SharedSceneState>({
    explodedRatio: 0,
    waterCutaway: false,
    showAcousticWaves: true,
    showPlume: true,
    sensorDistanceM: params.sensorDistanceM,
    hydrostaticHeadM: params.hydrostaticHeadM,
    orificeDiameterMm: params.orificeDiameterMm,
    orificeDeformationState: calculateDamOrificeDeformationState(params.orificeDiameterMm),
    turbineRpm: params.turbineRpm,
    signatureClass: params.signatureClass,
    regimeProfile: getDam3DRegimeAnimationProfile(params),
    pulsePeriodMs: calculateAcousticPulsePeriodMs(params.sensorDistanceM),
    cameraTransition: null,
  });

  useEffect(() => {
    stateRef.current.explodedRatio = explodedRatio;
    stateRef.current.waterCutaway = waterCutaway;
    stateRef.current.showAcousticWaves = showAcousticWaves;
    stateRef.current.showPlume = showPlume;
    stateRef.current.sensorDistanceM = params.sensorDistanceM;
    stateRef.current.hydrostaticHeadM = params.hydrostaticHeadM;
    stateRef.current.orificeDiameterMm = params.orificeDiameterMm;
    stateRef.current.orificeDeformationState = orificeDeformationState;
    stateRef.current.turbineRpm = params.turbineRpm;
    stateRef.current.signatureClass = params.signatureClass;
    stateRef.current.regimeProfile = regimeProfile;
    stateRef.current.pulsePeriodMs = calculateAcousticPulsePeriodMs(params.sensorDistanceM);
  }, [
    explodedRatio,
    waterCutaway,
    showAcousticWaves,
    showPlume,
    params,
    regimeProfile,
    orificeDeformationState,
  ]);

  const handleCameraPreset = (preset: CameraPreset) => {
    setActiveCameraPreset(preset.id);
    stateRef.current.cameraTransition = {
      targetPos: preset.position,
      targetLookAt: preset.target,
      progress: 0,
    };
  };

  const handleSelectSoundRegime = (option: (typeof SOUND_TYPE_OPTIONS)[number]) => {
    onSelectPreset(option.presetKey);
    if (option.classId === 'internal_piping') {
      setWaterCutaway(true);
    }
    const camPreset = CAMERA_PRESETS.find((c) => c.id === option.cameraPreset);
    if (camPreset) {
      handleCameraPreset(camPreset);
    }
  };

  const pulsePeriodMs = calculateAcousticPulsePeriodMs(params.sensorDistanceM);
  const pulseBpm = Math.round((1000 / pulsePeriodMs) * 60);
  const attenuation = calculateAcousticAttenuation(params.sensorDistanceM);

  return (
    <div className="relative w-full h-[calc(100vh-8.5rem)] min-h-[580px] rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-950 shadow-2xl select-none">
      {/* React-Three-Fiber 3D WebGL Canvas */}
      <div
        className="w-full h-full cursor-grab active:cursor-grabbing"
        data-testid="dam-3d-canvas-container"
      >
        <Canvas
          frameloop={IS_SOFTWARE_GL ? 'never' : 'always'}
          dpr={IS_SOFTWARE_GL ? 1 : [1, 2]}
          shadows={!IS_SOFTWARE_GL}
          camera={{ position: [-6, 30, 52], fov: 44, near: 0.5, far: 450 }}
          gl={{
            antialias: !IS_SOFTWARE_GL,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.12,
          }}
        >
          <DamProceduralTwinScene stateRef={stateRef} onHoverPart={setHoveredPartName} />
          <DamBaseLeakParticleSystem config={baseLeakParticleConfig} visible={showPlume} />
          {/* Conditional rendering inside the 3D dam model when orificeDiameterMm > 15mm */}
          {orificeDeformationState.isDeformed && (
            <MonolithCrackDeformationOverlay state={orificeDeformationState} visible={showPlume} />
          )}
        </Canvas>
      </div>

      {/* Top-Left HUD: Live 3D Sound Regime, R3F Base Leak & >15mm Crack Mesh Deformation Telemetry */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 max-w-md pointer-events-auto">
        <div className="bg-slate-900/92 border border-slate-700/80 rounded-xl px-3.5 py-2.5 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                3D Hydro-Acoustic Dam Twin
              </span>
            </div>
            <span
              data-testid="dam-3d-regime-badge"
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${
                regimeProfile.severity === 'Critical' || orificeDeformationState.isDeformed
                  ? 'bg-rose-950/90 border-rose-500/70 text-rose-300'
                  : regimeProfile.severity === 'Drifting'
                  ? 'bg-amber-950/90 border-amber-500/70 text-amber-300'
                  : 'bg-emerald-950/90 border-emerald-500/70 text-emerald-300'
              }`}
            >
              {regimeProfile.badgeLabel}
            </span>
          </div>

          <p className="text-xs font-semibold text-white mt-1.5 flex items-center gap-1.5">
            {regimeProfile.isDanger || orificeDeformationState.isDeformed ? (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span data-testid="dam-3d-regime-title">{regimeProfile.title}</span>
          </p>

          <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
            {regimeProfile.animationSummary}
          </p>

          {/* R3F Dam Base Leak Particle Status Row */}
          <div
            data-testid="r3f-base-leak-particle-status"
            className={`mt-2 px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 text-[11px] ${
              baseLeakParticleConfig.isActive
                ? 'bg-sky-950/80 border-sky-500/50 text-sky-200'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
          >
            <div className="flex items-center gap-1.5 truncate">
              <Droplets className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-semibold">
                {baseLeakParticleConfig.isActive
                  ? `R3F Base Leak: ${baseLeakParticleConfig.activeParticleCount} Bubbles/Droplets (${(
                      baseLeakParticleConfig.leakProbability * 100
                    ).toFixed(1)}% Prob)`
                  : `R3F Base Leak: Dormant (${(
                      baseLeakParticleConfig.leakProbability * 100
                    ).toFixed(1)}% Prob)`}
              </span>
            </div>
            {baseLeakParticleConfig.isActive && (
              <button
                type="button"
                data-testid="focus-base-leak-btn"
                onClick={() => {
                  setWaterCutaway(true);
                  const basePreset = CAMERA_PRESETS.find((c) => c.id === 'base_leak');
                  if (basePreset) handleCameraPreset(basePreset);
                }}
                className="px-2 py-0.5 rounded bg-cyan-500/25 hover:bg-cyan-500/40 border border-cyan-400/50 text-cyan-200 font-bold text-[10px] shrink-0 cursor-pointer"
              >
                Inspect Base
              </button>
            )}
          </div>

          {/* Conditional >15mm Crack Texture & Mesh Deformation Status Row */}
          <div
            data-testid="orifice-deformation-status"
            className={`mt-1.5 px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 text-[11px] ${
              orificeDeformationState.isDeformed
                ? 'bg-rose-950/85 border-rose-500/70 text-rose-200'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
          >
            <div className="flex items-center gap-1.5 truncate">
              <ShieldAlert
                className={`w-3.5 h-3.5 shrink-0 ${
                  orificeDeformationState.isDeformed ? 'text-rose-400' : 'text-slate-400'
                }`}
              />
              <span className="font-semibold truncate">
                {orificeDeformationState.isDeformed
                  ? `Crack Mesh Deformation: ACTIVE (${params.orificeDiameterMm.toFixed(1)}mm > ${CRITICAL_ORIFICE_DEFORMATION_THRESHOLD_MM}mm)`
                  : `Crack Mesh Deformation: STANDBY (${params.orificeDiameterMm.toFixed(1)}mm ≤ ${CRITICAL_ORIFICE_DEFORMATION_THRESHOLD_MM}mm)`}
              </span>
            </div>
            {orificeDeformationState.isDeformed && (
              <button
                type="button"
                data-testid="focus-crack-breach-btn"
                onClick={() => {
                  const leakPreset = CAMERA_PRESETS.find((c) => c.id === 'leak');
                  if (leakPreset) handleCameraPreset(leakPreset);
                }}
                className="px-2 py-0.5 rounded bg-rose-500/30 hover:bg-rose-500/50 border border-rose-400/60 text-rose-200 font-bold text-[10px] shrink-0 cursor-pointer"
              >
                Inspect Breach
              </button>
            )}
          </div>

          <div className="mt-2 pt-1.5 border-t border-slate-800 flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400 truncate">
              Inspecting: <strong className="text-slate-200">{hoveredPartName}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                const targetCam = CAMERA_PRESETS.find(
                  (c) => c.id === regimeProfile.recommendedCameraPreset
                );
                if (targetCam) handleCameraPreset(targetCam);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600/30 hover:bg-sky-600/50 border border-sky-500/50 text-sky-200 font-semibold text-[10px] shrink-0 cursor-pointer transition-colors"
            >
              <Crosshair className="w-3 h-3" />
              Focus Anomaly
            </button>
          </div>
        </div>
      </div>

      {/* Top-Right HUD: Camera Viewpoint Presets */}
      <div className="absolute top-4 right-4 z-10 flex flex-wrap items-center justify-end gap-1.5 max-w-lg">
        {CAMERA_PRESETS.map((preset) => {
          const isActive = activeCameraPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleCameraPreset(preset)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                isActive
                  ? 'bg-sky-500 border-sky-400 text-slate-950 shadow-md'
                  : 'bg-slate-900/90 border-slate-700/80 text-slate-200 hover:bg-slate-800 hover:border-slate-600'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Bottom Floating Interactive Control Dock (Collapsible) */}
      <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-3 pointer-events-none">
        <div className="bg-slate-900/95 border border-slate-700/80 rounded-xl p-3.5 shadow-xl pointer-events-auto flex-1 max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsDockCollapsed((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                {isDockCollapsed ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
                    Expand Controls
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5 text-sky-400" />
                    Hide Controls
                  </>
                )}
              </button>

              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 hidden sm:inline flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400 inline mr-1" />
                3D Sound Type Animations:
              </span>
            </div>

            {/* 4 Direct Sound Type Animation Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {SOUND_TYPE_OPTIONS.map((opt) => {
                const isSelected = params.signatureClass === opt.classId;
                const badgeTone =
                  opt.dangerLevel === 'DANGER'
                    ? isSelected
                      ? 'bg-rose-600 border-rose-400 text-white shadow-sm'
                      : 'bg-rose-950/70 border-rose-700/60 text-rose-200 hover:bg-rose-900/70'
                    : opt.dangerLevel === 'WARNING'
                    ? isSelected
                      ? 'bg-amber-500 border-amber-300 text-slate-950 shadow-sm'
                      : 'bg-amber-950/70 border-amber-700/60 text-amber-200 hover:bg-amber-900/70'
                    : isSelected
                    ? 'bg-emerald-500 border-emerald-300 text-slate-950 shadow-sm'
                    : 'bg-emerald-950/70 border-emerald-700/60 text-emerald-200 hover:bg-emerald-900/70';

                return (
                  <button
                    key={opt.classId}
                    type="button"
                    data-testid={`sound-anim-btn-${opt.classId}`}
                    onClick={() => handleSelectSoundRegime(opt)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${badgeTone}`}
                  >
                    <span className="text-[9px] px-1 py-0.2 rounded bg-black/30 font-mono">
                      {opt.dangerLevel}
                    </span>
                    <span>{opt.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {!isDockCollapsed && (
            <div className="mt-3 pt-2.5 border-t border-slate-800">
              {/* Row 1: Layer Toggles & Quick Reset */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWaterCutaway((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      waterCutaway
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {waterCutaway ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    {waterCutaway ? 'Restore Water Opacity' : 'Water Cutaway (Inspect Underwater)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAcousticWaves((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      showAcousticWaves
                        ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    <Waves className="w-3.5 h-3.5" />
                    3D Acoustic Rings: {showAcousticWaves ? 'ON' : 'OFF'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPlume((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      showPlume
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    R3F Base Leak Particles: {showPlume ? 'ON' : 'OFF'}
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-orifice-breach-btn"
                    onClick={() => {
                      const nextVal = orificeDeformationState.isDeformed ? 3.2 : 18.5;
                      onUpdateParam('orificeDiameterMm', nextVal);
                      if (nextVal > CRITICAL_ORIFICE_DEFORMATION_THRESHOLD_MM) {
                        const leakCam = CAMERA_PRESETS.find((c) => c.id === 'leak');
                        if (leakCam) handleCameraPreset(leakCam);
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      orificeDeformationState.isDeformed
                        ? 'bg-rose-600 border-rose-400 text-white shadow-sm'
                        : 'bg-rose-950/60 border-rose-700/70 text-rose-200 hover:bg-rose-900/70'
                    }`}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    {orificeDeformationState.isDeformed
                      ? 'Restore Normal Crack (3.2mm)'
                      : 'Simulate >15mm Crack Breach (18.5mm)'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-slate-300 bg-slate-800/90 px-2.5 py-1 rounded-md border border-slate-700">
                    <Radio className="w-3.5 h-3.5 text-sky-400" />
                    <span>Pulse: {pulseBpm} BPM</span>
                    <span className="text-slate-500">|</span>
                    <span>
                      {baseLeakParticleConfig.isActive
                        ? `Base Discharge: ${baseLeakParticleConfig.estimatedFlowRateLpm} L/min`
                        : 'Base Seal: Intact'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setExplodedRatio(0);
                      setWaterCutaway(false);
                      handleCameraPreset(CAMERA_PRESETS[0]);
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>
              </div>

              {/* Row 2: Interactive Sliders (Orifice Diameter, Exploded View & Hydrophone Distance) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2.5">
                <div
                  className={`rounded-lg p-2.5 border transition-colors ${
                    orificeDeformationState.isDeformed
                      ? 'bg-rose-950/50 border-rose-500/70'
                      : 'bg-slate-800/80 border-slate-700/60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <ShieldAlert
                        className={`w-3.5 h-3.5 ${
                          orificeDeformationState.isDeformed ? 'text-rose-400' : 'text-amber-400'
                        }`}
                      />
                      Orifice / Crack Size (mm)
                    </span>
                    <div className="flex items-center gap-1.5 font-mono text-xs">
                      <span
                        data-testid="dam-3d-orifice-value"
                        className={`font-bold ${
                          orificeDeformationState.isDeformed ? 'text-rose-300' : 'text-white'
                        }`}
                      >
                        {params.orificeDiameterMm.toFixed(1)}mm
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${
                          orificeDeformationState.isDeformed
                            ? 'bg-rose-600 text-white border-rose-400'
                            : 'bg-slate-900 text-slate-400 border-slate-700'
                        }`}
                      >
                        {orificeDeformationState.isDeformed ? '>15mm DEFORMED' : '≤15mm INTACT'}
                      </span>
                    </div>
                  </div>
                  <input
                    type="range"
                    data-testid="dam-3d-orifice-slider"
                    min="0.5"
                    max="25.0"
                    step="0.5"
                    value={params.orificeDiameterMm}
                    onChange={(e) =>
                      onUpdateParam('orificeDiameterMm', parseFloat(e.target.value))
                    }
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
                  />
                </div>

                <div className="bg-slate-800/80 rounded-lg p-2.5 border border-slate-700/60">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-sky-400" />
                      Structural Exploded View
                    </span>
                    <span className="font-mono text-sky-400 font-bold">
                      {Math.round(explodedRatio * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={explodedRatio}
                    onChange={(e) => setExplodedRatio(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                  />
                </div>

                <div className="bg-slate-800/80 rounded-lg p-2.5 border border-slate-700/60">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                      Hydrophone Distance (m)
                    </span>
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="text-white font-bold">{params.sensorDistanceM}m</span>
                      <span className="text-[10px] text-indigo-300 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">
                        -{attenuation.attenuationDb} dB loss
                      </span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="120"
                    step="1"
                    value={params.sensorDistanceM}
                    onChange={(e) =>
                      onUpdateParam('sensorDistanceM', parseFloat(e.target.value))
                    }
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

