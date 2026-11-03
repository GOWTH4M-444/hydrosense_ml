/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  GeneratorParams,
  PRESET_CONFIGS,
  calculateAcousticPulsePeriodMs,
  calculateAcousticAttenuation,
  CLASS_METADATA,
} from '../utils/acousticEngine';
import {
  Camera,
  Layers,
  Eye,
  EyeOff,
  Radio,
  Sliders,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Volume2,
  Sparkles,
  Maximize2,
  CheckCircle2,
  Droplets,
  HelpCircle,
} from 'lucide-react';

interface Dam3DSceneViewProps {
  params: GeneratorParams;
  activePresetKey: string;
  onSelectPreset: (presetKey: string) => void;
  onUpdateParam: <K extends keyof GeneratorParams>(key: K, value: GeneratorParams[K]) => void;
  whimsicalName: string;
  onJumpToWorkbench?: () => void;
}

// Pre-allocated scratch objects at module scope to eliminate GC churn inside render loop
const _vec3 = new THREE.Vector3();
const _targetVec = new THREE.Vector3();
const _camTargetVec = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();

// Procedural texture generators (zero external files, zero 404s)
function createConcreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Concrete base tone
    ctx.fillStyle = '#9e9fa4';
    ctx.fillRect(0, 0, 512, 512);

    // Fine granular aggregate noise
    const imgData = ctx.getImageData(0, 0, 512, 512);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 38;
      data[i] = Math.min(255, Math.max(0, data[i] + n));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
    }
    ctx.putImageData(imgData, 0, 0);

    // Formwork seams and lift joints
    ctx.strokeStyle = '#74757c';
    ctx.lineWidth = 2.5;
    for (let y = 64; y < 512; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#82838a';
    ctx.lineWidth = 1.5;
    for (let x = 128; x < 512; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }

    // Tie-rod holes
    ctx.fillStyle = '#424348';
    for (let y = 32; y < 512; y += 64) {
      for (let x = 64; x < 512; x += 128) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 2);
  return texture;
}

function createRockTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Canyon bedrock sandstone base
    ctx.fillStyle = '#65574c';
    ctx.fillRect(0, 0, 512, 512);

    // Geological horizontal strata bands
    for (let y = 0; y < 512; y += 16) {
      const shade = 70 + Math.sin(y * 0.08) * 25 + Math.random() * 20;
      ctx.fillStyle = `rgb(${shade + 20}, ${shade}, ${shade - 10})`;
      ctx.fillRect(0, y, 512, 16);
    }

    // Micro-rock grain
    const imgData = ctx.getImageData(0, 0, 512, 512);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 32;
      data[i] = Math.min(255, Math.max(0, data[i] + n));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
    }
    ctx.putImageData(imgData, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function createSensorDecalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, 0, 256, 128);

    // Danger / Industrial stripes
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    for (let x = -50; x < 300; x += 36) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 18, 0);
      ctx.lineTo(x - 6, 128);
      ctx.lineTo(x - 24, 128);
      ctx.closePath();
    }
    ctx.fill();

    // Text marking
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(20, 44, 216, 40);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HYDROPHONE ARRAY CH-01', 128, 64);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type CameraPreset = 'overview' | 'hydrophone' | 'leak' | 'spillway' | 'aerial';

interface PresetCamPosition {
  pos: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: Record<CameraPreset, PresetCamPosition> = {
  overview: { pos: [-6, 30, 52], target: [0, 6, 6] },
  hydrophone: { pos: [8, 4, 30], target: [8, -10, 18] },
  leak: { pos: [-2, -2, 16], target: [-2, -8, 4.3] },
  spillway: { pos: [0, 26, 22], target: [0, 16, -4] },
  aerial: { pos: [0, 62, 26], target: [0, 0, 8] },
};

export const Dam3DSceneView: React.FC<Dam3DSceneViewProps> = ({
  params,
  activePresetKey,
  onSelectPreset,
  onUpdateParam,
  whimsicalName,
  onJumpToWorkbench,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // UI state for bottom collapsible dock
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [activeCamPreset, setActiveCamPreset] = useState<CameraPreset>('overview');
  const [explodedRatio, setExplodedRatio] = useState<number>(0);
  const [waterCutaway, setWaterCutaway] = useState<boolean>(false);
  const [showAcousticWaves, setShowAcousticWaves] = useState<boolean>(true);
  const [showPlume, setShowPlume] = useState<boolean>(true);

  // Dynamic acoustic state calculation
  const pulsePeriodMs = useMemo(
    () => calculateAcousticPulsePeriodMs(params.sensorDistanceM),
    [params.sensorDistanceM]
  );
  const attenuation = useMemo(
    () => calculateAcousticAttenuation(params.sensorDistanceM),
    [params.sensorDistanceM]
  );

  // Mutable refs to pass React state to the Three.js loop without re-instantiating the WebGL context
  const stateRef = useRef({
    explodedRatio: 0,
    waterCutaway: false,
    showAcousticWaves: true,
    showPlume: true,
    sensorDistanceM: params.sensorDistanceM,
    hydrostaticHeadM: params.hydrostaticHeadM,
    pulsePeriodMs,
    targetCamPos: new THREE.Vector3(...CAMERA_PRESETS.overview.pos),
    targetCamTarget: new THREE.Vector3(...CAMERA_PRESETS.overview.target),
    isCamAnimating: false,
  });

  // Keep stateRef in sync with React props/state
  useEffect(() => {
    stateRef.current.explodedRatio = explodedRatio;
    stateRef.current.waterCutaway = waterCutaway;
    stateRef.current.showAcousticWaves = showAcousticWaves;
    stateRef.current.showPlume = showPlume;
    stateRef.current.sensorDistanceM = params.sensorDistanceM;
    stateRef.current.hydrostaticHeadM = params.hydrostaticHeadM;
    stateRef.current.pulsePeriodMs = pulsePeriodMs;
  }, [explodedRatio, waterCutaway, showAcousticWaves, showPlume, params, pulsePeriodMs]);

  const handleSelectCameraPreset = (preset: CameraPreset) => {
    setActiveCamPreset(preset);
    const target = CAMERA_PRESETS[preset];
    stateRef.current.targetCamPos.set(...target.pos);
    stateRef.current.targetCamTarget.set(...target.target);
    stateRef.current.isCamAnimating = true;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Detect software WebGL from GPU renderer string
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 2. Setup Three.js Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // 3. Scene & Camera
    const scene = new THREE.Scene();
    const skyBgColor = 0xcfe2ee;
    scene.background = new THREE.Color(skyBgColor);
    scene.fog = new THREE.FogExp2(skyBgColor, 0.009);

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.5, 300);
    camera.position.set(...CAMERA_PRESETS.overview.pos);

    // Studio Environment map via RoomEnvironment + PMREMGenerator
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 4. Lighting Rig (Studio standard: warm directional key, cool hemisphere fill, rim)
    const sunKey = new THREE.DirectionalLight(0xfff5e6, 2.3);
    sunKey.position.set(45, 60, 35);
    sunKey.castShadow = !isSoftwareGl;
    if (!isSoftwareGl) {
      sunKey.shadow.mapSize.width = 1024;
      sunKey.shadow.mapSize.height = 1024;
      sunKey.shadow.camera.near = 10;
      sunKey.shadow.camera.far = 160;
      sunKey.shadow.camera.left = -45;
      sunKey.shadow.camera.right = 45;
      sunKey.shadow.camera.top = 45;
      sunKey.shadow.camera.bottom = -45;
      sunKey.shadow.bias = -0.0005;
      sunKey.shadow.normalBias = 0.02;
    }
    scene.add(sunKey);

    const hemiLight = new THREE.HemisphereLight(0x7ea7c8, 0x3d4e42, 1.25);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x88b8e0, 1.0);
    rimLight.position.set(-40, 25, -35);
    scene.add(rimLight);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 150;
    controls.target.set(...CAMERA_PRESETS.overview.target);
    controls.addEventListener('start', () => {
      stateRef.current.isCamAnimating = false;
    });

    // 5. Procedural Textures & Materials
    const concreteTex = createConcreteTexture();
    const rockTex = createRockTexture();
    const sensorDecalTex = createSensorDecalTexture();

    if (!isSoftwareGl) {
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      concreteTex.anisotropy = maxAniso;
      rockTex.anisotropy = maxAniso;
      sensorDecalTex.anisotropy = maxAniso;
    }

    // Material library: varied roughness and metalness >= 0.25 between adjacent parts
    const concreteDamMat = new THREE.MeshStandardMaterial({
      map: concreteTex,
      roughness: 0.85,
      metalness: 0.1,
      color: 0xdedfe2,
    });

    const bedrockMat = new THREE.MeshStandardMaterial({
      map: rockTex,
      roughness: 0.95,
      metalness: 0.05,
      color: 0x6e6358,
    });

    const steelGateMat = new THREE.MeshStandardMaterial({
      roughness: 0.28,
      metalness: 0.88,
      color: 0x3a4556,
    });

    const railingMat = new THREE.MeshStandardMaterial({
      roughness: 0.35,
      metalness: 0.8,
      color: 0xe2e8f0,
    });

    const sensorBodyMat = new THREE.MeshStandardMaterial({
      map: sensorDecalTex,
      roughness: 0.3,
      metalness: 0.82,
      color: 0xf59e0b,
    });

    const sensorTransducerMat = new THREE.MeshStandardMaterial({
      roughness: 0.2,
      metalness: 0.9,
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.6,
    });

    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x08708c,
      roughness: 0.12,
      metalness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.85,
      transparent: true,
      opacity: 0.72,
      ior: 1.333,
      depthWrite: false,
    });

    const waterBottomFloorMat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0.05,
      color: 0x1f3438,
    });

    // 6. BUILD PROCEDURAL 3D DAM MODEL (3–12 Part Composite Group)
    const masterSceneGroup = new THREE.Group();
    scene.add(masterSceneGroup);

    // Groups for exploded view handling
    const damFoundationGroup = new THREE.Group();
    const damMonolithGroup = new THREE.Group();
    const damCrestGroup = new THREE.Group();
    const spillwayGatesGroup = new THREE.Group();
    const intakeTowerGroup = new THREE.Group();
    const powerhouseGroup = new THREE.Group();
    const hydrophoneBuoyGroup = new THREE.Group();
    const acousticLeakGroup = new THREE.Group();

    masterSceneGroup.add(damFoundationGroup);
    masterSceneGroup.add(damMonolithGroup);
    masterSceneGroup.add(damCrestGroup);
    masterSceneGroup.add(spillwayGatesGroup);
    masterSceneGroup.add(intakeTowerGroup);
    masterSceneGroup.add(powerhouseGroup);
    masterSceneGroup.add(hydrophoneBuoyGroup);
    masterSceneGroup.add(acousticLeakGroup);

    // PART 1: Bedrock Foundation and Riverbed Canyon
    // Extended beyond view with natural walls (no box in void)
    const riverbedGeo = new THREE.BoxGeometry(110, 8, 90);
    const riverbedMesh = new THREE.Mesh(riverbedGeo, bedrockMat);
    riverbedMesh.position.set(0, -20, 0);
    riverbedMesh.receiveShadow = !isSoftwareGl;
    damFoundationGroup.add(riverbedMesh);

    // Left canyon rock face
    const leftCliffGeo = new THREE.BoxGeometry(24, 54, 90);
    const leftCliff = new THREE.Mesh(leftCliffGeo, bedrockMat);
    leftCliff.position.set(-48, 6, 0);
    leftCliff.castShadow = !isSoftwareGl;
    leftCliff.receiveShadow = !isSoftwareGl;
    damFoundationGroup.add(leftCliff);

    // Right canyon rock face
    const rightCliffGeo = new THREE.BoxGeometry(24, 54, 90);
    const rightCliff = new THREE.Mesh(rightCliffGeo, bedrockMat);
    rightCliff.position.set(48, 6, 0);
    rightCliff.castShadow = !isSoftwareGl;
    rightCliff.receiveShadow = !isSoftwareGl;
    damFoundationGroup.add(rightCliff);

    // Downstream contact shadow plane beneath dam toe
    const contactShadowGeo = new THREE.PlaneGeometry(64, 40);
    const contactShadowMat = new THREE.MeshBasicMaterial({
      color: 0x11161d,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, -15.98, -12);
    damFoundationGroup.add(contactShadow);

    // PART 2: Main Concrete Gravity Dam Monolith Body
    // Sloped downstream face + vertical upstream face
    const damWidth = 62;
    const damHeight = 32;
    const damCrestThickness = 8;
    const damBaseThickness = 28;

    const damShape = new THREE.Shape();
    damShape.moveTo(-damCrestThickness / 2, damHeight);
    damShape.lineTo(damCrestThickness / 2, damHeight);
    damShape.lineTo(damBaseThickness - damCrestThickness / 2, 0);
    damShape.lineTo(-damCrestThickness / 2, 0);
    damShape.closePath();

    const extrudeSettings = {
      steps: 1,
      depth: damWidth,
      bevelEnabled: true,
      bevelThickness: 0.4,
      bevelSize: 0.4,
      bevelSegments: 2,
    };

    const monolithGeo = new THREE.ExtrudeGeometry(damShape, extrudeSettings);
    monolithGeo.center();
    const monolithMesh = new THREE.Mesh(monolithGeo, concreteDamMat);
    monolithMesh.rotation.y = Math.PI / 2;
    monolithMesh.position.set(0, 0, 0);
    monolithMesh.castShadow = !isSoftwareGl;
    monolithMesh.receiveShadow = !isSoftwareGl;
    damMonolithGroup.add(monolithMesh);

    // Monolith vertical construction expansion joints
    for (let x = -20; x <= 20; x += 10) {
      const jointGeo = new THREE.BoxGeometry(0.12, damHeight + 0.5, damBaseThickness + 0.8);
      const jointMat = new THREE.MeshBasicMaterial({ color: 0x3e4046 });
      const jointMesh = new THREE.Mesh(jointGeo, jointMat);
      jointMesh.position.set(x, 0, 0);
      damMonolithGroup.add(jointMesh);
    }

    // PART 3: Dam Crest & Service Roadway
    const crestRoadGeo = new THREE.BoxGeometry(damWidth, 1.2, damCrestThickness + 2.5);
    const crestRoadMat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0.15,
      color: 0x475569,
    });
    const crestRoad = new THREE.Mesh(crestRoadGeo, crestRoadMat);
    crestRoad.position.set(0, damHeight / 2 + 0.6, 0);
    crestRoad.castShadow = !isSoftwareGl;
    crestRoad.receiveShadow = !isSoftwareGl;
    damCrestGroup.add(crestRoad);

    // Roadway center dashed line
    const roadStripeGeo = new THREE.PlaneGeometry(damWidth - 4, 0.4);
    const roadStripeMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const roadStripe = new THREE.Mesh(roadStripeGeo, roadStripeMat);
    roadStripe.rotation.x = -Math.PI / 2;
    roadStripe.position.set(0, damHeight / 2 + 1.22, 0);
    damCrestGroup.add(roadStripe);

    // Guardrails on both sides of the crest roadway
    [-damCrestThickness / 2 - 0.9, damCrestThickness / 2 + 0.9].forEach((zPos) => {
      const railGeo = new THREE.BoxGeometry(damWidth, 1.1, 0.25);
      const railing = new THREE.Mesh(railGeo, railingMat);
      railing.position.set(0, damHeight / 2 + 1.8, zPos);
      railing.castShadow = !isSoftwareGl;
      damCrestGroup.add(railing);
    });

    // Streetlights along crest
    for (let x = -24; x <= 24; x += 12) {
      const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 3.2, 8);
      const pole = new THREE.Mesh(poleGeo, railingMat);
      pole.position.set(x, damHeight / 2 + 2.8, -damCrestThickness / 2 - 0.7);
      damCrestGroup.add(pole);

      const lampHeadGeo = new THREE.BoxGeometry(0.3, 0.15, 0.6);
      const lampHead = new THREE.Mesh(lampHeadGeo, railingMat);
      lampHead.position.set(x, damHeight / 2 + 4.4, -damCrestThickness / 2 - 0.4);
      damCrestGroup.add(lampHead);
    }

    // PART 4: Spillway Piers & Radial Floodgates
    const pierWidth = 1.4;
    const pierHeight = 9;
    const pierLength = 11;

    [-7, 0, 7].forEach((xPier) => {
      const pierGeo = new THREE.BoxGeometry(pierWidth, pierHeight, pierLength);
      const pier = new THREE.Mesh(pierGeo, concreteDamMat);
      pier.position.set(xPier, damHeight / 2 + 3.8, -1.2);
      pier.castShadow = !isSoftwareGl;
      pier.receiveShadow = !isSoftwareGl;
      spillwayGatesGroup.add(pier);
    });

    // Radial curved steel floodgates between piers
    [-3.5, 3.5].forEach((xGate) => {
      const gateGeo = new THREE.CylinderGeometry(4.2, 4.2, 5.2, 16, 1, false, 0, Math.PI * 0.45);
      const gate = new THREE.Mesh(gateGeo, steelGateMat);
      gate.rotation.z = Math.PI / 2;
      gate.rotation.y = Math.PI * 0.78;
      gate.position.set(xGate, damHeight / 2 + 1.5, -3.2);
      gate.castShadow = !isSoftwareGl;
      spillwayGatesGroup.add(gate);
    });

    // PART 5: Upstream Water Intake Tower & Footbridge
    const intakeTowerGeo = new THREE.CylinderGeometry(3.2, 3.8, 30, 12);
    const intakeTower = new THREE.Mesh(intakeTowerGeo, concreteDamMat);
    intakeTower.position.set(18, -1, 14);
    intakeTower.castShadow = !isSoftwareGl;
    intakeTower.receiveShadow = !isSoftwareGl;
    intakeTowerGroup.add(intakeTower);

    // Intake trash rack screen (metallic grating at bottom)
    const trashRackGeo = new THREE.CylinderGeometry(3.5, 4.0, 10, 12, 1, true);
    const trashRackMat = new THREE.MeshStandardMaterial({
      roughness: 0.35,
      metalness: 0.82,
      color: 0x1e293b,
      wireframe: true,
    });
    const trashRack = new THREE.Mesh(trashRackGeo, trashRackMat);
    trashRack.position.set(18, -11, 14);
    intakeTowerGroup.add(trashRack);

    // Intake Service Bridge connecting to dam crest
    const bridgeGeo = new THREE.BoxGeometry(3.2, 0.8, 14);
    const bridge = new THREE.Mesh(bridgeGeo, concreteDamMat);
    bridge.position.set(18, damHeight / 2 + 0.6, 7);
    bridge.castShadow = !isSoftwareGl;
    intakeTowerGroup.add(bridge);

    // PART 6: Downstream Powerhouse & Penstock Gallery
    const powerhouseGeo = new THREE.BoxGeometry(24, 9, 14);
    const powerhouse = new THREE.Mesh(powerhouseGeo, concreteDamMat);
    powerhouse.position.set(-16, -11.5, -20);
    powerhouse.castShadow = !isSoftwareGl;
    powerhouse.receiveShadow = !isSoftwareGl;
    powerhouseGroup.add(powerhouse);

    // Penstock discharge tunnel portals
    [-20, -16, -12].forEach((xPort) => {
      const portGeo = new THREE.CylinderGeometry(1.4, 1.4, 3, 16);
      const portMesh = new THREE.Mesh(portGeo, steelGateMat);
      portMesh.rotation.x = Math.PI / 2;
      portMesh.position.set(xPort, -14, -13);
      powerhouseGroup.add(portMesh);
    });

    // PART 7: Submerged Hydrophone Array Buoy & Mooring Rig
    const buoyRadius = 1.4;
    const buoyGeo = new THREE.SphereGeometry(buoyRadius, 16, 12);
    const buoyMat = new THREE.MeshStandardMaterial({
      roughness: 0.25,
      metalness: 0.7,
      color: 0xf97316,
    });
    const buoy = new THREE.Mesh(buoyGeo, buoyMat);
    buoy.position.set(8, 2.0, 18);
    buoy.castShadow = !isSoftwareGl;
    hydrophoneBuoyGroup.add(buoy);

    // Buoy beacon mast & flashing navigation lamp
    const mastGeo = new THREE.CylinderGeometry(0.06, 0.08, 2.5, 8);
    const mast = new THREE.Mesh(mastGeo, railingMat);
    mast.position.set(8, 3.8, 18);
    hydrophoneBuoyGroup.add(mast);

    const beaconLightGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const beaconLightMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const beaconLight = new THREE.Mesh(beaconLightGeo, beaconLightMat);
    beaconLight.position.set(8, 5.0, 18);
    hydrophoneBuoyGroup.add(beaconLight);

    // Mooring & Signal Cable descending to sensor
    const cableCurve = new THREE.LineCurve3(
      new THREE.Vector3(8, 1.8, 18),
      new THREE.Vector3(8, -12, 18)
    );
    const cableGeo = new THREE.TubeGeometry(cableCurve, 16, 0.09, 6, false);
    const cableMat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      metalness: 0.3,
      color: 0x0f172a,
    });
    const cableMesh = new THREE.Mesh(cableGeo, cableMat);
    hydrophoneBuoyGroup.add(cableMesh);

    // Underwater Hydrophone Sensor Array Capsule
    const sensorCanisterGeo = new THREE.CylinderGeometry(0.9, 0.9, 2.8, 16);
    const sensorCanister = new THREE.Mesh(sensorCanisterGeo, sensorBodyMat);
    sensorCanister.position.set(8, -12, 18);
    sensorCanister.castShadow = !isSoftwareGl;
    hydrophoneBuoyGroup.add(sensorCanister);

    // Transducer acoustic ring bands
    [-0.7, 0, 0.7].forEach((yOffset) => {
      const ringGeo = new THREE.TorusGeometry(0.92, 0.08, 8, 24);
      const ringMesh = new THREE.Mesh(ringGeo, sensorTransducerMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.set(8, -12 + yOffset, 18);
      hydrophoneBuoyGroup.add(ringMesh);
    });

    // Mooring heavy sinker anchor block at bedrock
    const anchorGeo = new THREE.BoxGeometry(2.4, 1.2, 2.4);
    const anchor = new THREE.Mesh(anchorGeo, concreteDamMat);
    anchor.position.set(8, -15.4, 18);
    hydrophoneBuoyGroup.add(anchor);

    // PART 8: Acoustic Leak Source (Fissure Crack, Rising Bubble Plume, Acoustic Wave Rings)
    // Concrete crack fissure indicator on monolith upstream face
    const crackGeo = new THREE.BoxGeometry(0.3, 3.4, 0.15);
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x020617 });
    const crackMesh = new THREE.Mesh(crackGeo, crackMat);
    crackMesh.position.set(-2, -8, 4.05);
    acousticLeakGroup.add(crackMesh);

    // Rising Bubble Plume (Instanced particles)
    const bubbleCount = 42;
    const bubbleGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const bubbleMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      roughness: 0.1,
      metalness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.9,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    const bubbleInstMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, bubbleCount);
    bubbleInstMesh.frustumCulled = false;
    acousticLeakGroup.add(bubbleInstMesh);

    // Bubble simulation particle states
    const bubbleData = Array.from({ length: bubbleCount }, (_, i) => ({
      x: -2 + (Math.random() - 0.5) * 1.2,
      baseY: -8,
      y: -8 + (i / bubbleCount) * 10,
      z: 4.3 + (Math.random() - 0.5) * 0.8,
      speed: 1.8 + Math.random() * 1.4,
      wobbleSpeed: 2.0 + Math.random() * 2.5,
      wobbleOffset: Math.random() * Math.PI * 2,
      scale: 0.6 + Math.random() * 0.8,
    }));

    // Dynamic Acoustic Compression Wavefront Rings
    const waveRingCount = 4;
    const waveRingMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < waveRingCount; i++) {
      const ringGeo = new THREE.RingGeometry(0.2, 0.45, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.set(-2, -8, 4.3);
      acousticLeakGroup.add(ringMesh);
      waveRingMeshes.push(ringMesh);
    }

    // PART 9: Reservoir Water Surface
    const waterGeo = new THREE.PlaneGeometry(62, 42, 32, 32);
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set(0, 1.8, 21);
    scene.add(waterMesh);

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Keyboard shortcut 'H' to toggle dock
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 7. RENDER LOOP WITH SOFTWARE-WEBGL GUARD & PACING
    let frameId = 0;
    const startTime = performance.now();
    let lastTime = startTime;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const elapsedTime = (now - startTime) / 1000;

      const currentState = stateRef.current;

      // 1. Smooth Exponential Damping for Camera Preset Transitions
      if (currentState.isCamAnimating) {
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          currentState.targetCamPos.x,
          3.5,
          delta
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          currentState.targetCamPos.y,
          3.5,
          delta
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          currentState.targetCamPos.z,
          3.5,
          delta
        );

        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          currentState.targetCamTarget.x,
          3.5,
          delta
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          currentState.targetCamTarget.y,
          3.5,
          delta
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          currentState.targetCamTarget.z,
          3.5,
          delta
        );

        if (
          camera.position.distanceTo(currentState.targetCamPos) < 0.25 &&
          controls.target.distanceTo(currentState.targetCamTarget) < 0.2
        ) {
          currentState.isCamAnimating = false;
        }
      }

      controls.update();

      // 2. Smooth Exploded View Layer Separation (Exponential Damping)
      const exp = currentState.explodedRatio;
      damCrestGroup.position.y = THREE.MathUtils.damp(damCrestGroup.position.y, exp * 14, 4.0, delta);
      spillwayGatesGroup.position.y = THREE.MathUtils.damp(
        spillwayGatesGroup.position.y,
        exp * 10,
        4.0,
        delta
      );
      intakeTowerGroup.position.x = THREE.MathUtils.damp(
        intakeTowerGroup.position.x,
        exp * 12,
        4.0,
        delta
      );
      powerhouseGroup.position.z = THREE.MathUtils.damp(
        powerhouseGroup.position.z,
        -exp * 14,
        4.0,
        delta
      );

      // 3. Dynamic Hydrophone Sensor Position based on sensorDistanceM
      // Distribute sensor in distance range: 5m to 120m maps to 3D offset
      const distOffset = (currentState.sensorDistanceM / 120) * 16;
      hydrophoneBuoyGroup.position.z = THREE.MathUtils.damp(
        hydrophoneBuoyGroup.position.z,
        distOffset,
        3.0,
        delta
      );

      // Buoy gentle water bobbing motion
      buoy.position.y = 2.0 + Math.sin(elapsedTime * 1.8) * 0.18;
      beaconLight.position.y = 5.0 + Math.sin(elapsedTime * 1.8) * 0.18;

      // 4. Water Cutaway / Transparency toggle
      const targetWaterOpacity = currentState.waterCutaway ? 0.18 : 0.74;
      waterMat.opacity = THREE.MathUtils.damp(waterMat.opacity, targetWaterOpacity, 5.0, delta);

      // Water subtle wave displacement
      const waterPositions = waterGeo.attributes.position;
      for (let i = 0; i < waterPositions.count; i++) {
        const u = waterPositions.getX(i);
        const v = waterPositions.getY(i);
        const wave =
          Math.sin(u * 0.35 + elapsedTime * 1.5) * 0.22 +
          Math.cos(v * 0.25 + elapsedTime * 1.2) * 0.18;
        waterPositions.setZ(i, wave);
      }
      waterPositions.needsUpdate = true;
      waterGeo.computeVertexNormals();

      // 5. Leak Bubble Plume Animation
      if (currentState.showPlume) {
        acousticLeakGroup.visible = true;
        bubbleInstMesh.visible = true;
        for (let i = 0; i < bubbleCount; i++) {
          const b = bubbleData[i];
          b.y += b.speed * delta;
          if (b.y > 1.8) {
            b.y = b.baseY;
          }
          const wobble = Math.sin(elapsedTime * b.wobbleSpeed + b.wobbleOffset) * 0.25;
          _vec3.set(b.x + wobble, b.y, b.z);
          _matrix.makeScale(b.scale, b.scale, b.scale);
          _matrix.setPosition(_vec3);
          bubbleInstMesh.setMatrixAt(i, _matrix);
        }
        bubbleInstMesh.instanceMatrix.needsUpdate = true;
      } else {
        bubbleInstMesh.visible = false;
      }

      // 6. Acoustic Pressure Wavefront Ring Propagation (Period = pulsePeriodMs)
      if (currentState.showAcousticWaves) {
        const periodSec = Math.max(0.4, currentState.pulsePeriodMs / 1000);
        waveRingMeshes.forEach((mesh, idx) => {
          mesh.visible = true;
          // Stagger waves
          const wavePhase = ((elapsedTime / periodSec + idx / waveRingCount) % 1);
          const currentRadius = 0.5 + wavePhase * 18;
          mesh.scale.set(currentRadius, currentRadius, 1);
          const mat = mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = (1 - wavePhase) * 0.72;
        });
      } else {
        waveRingMeshes.forEach((mesh) => {
          mesh.visible = false;
        });
      }

      // Render frame
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    // Start render loop
    tick();

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);

      // Dispose geometries & textures
      monolithGeo.dispose();
      crestRoadGeo.dispose();
      riverbedGeo.dispose();
      leftCliffGeo.dispose();
      rightCliffGeo.dispose();
      waterGeo.dispose();
      bubbleGeo.dispose();
      buoyGeo.dispose();
      concreteTex.dispose();
      rockTex.dispose();
      sensorDecalTex.dispose();

      concreteDamMat.dispose();
      bedrockMat.dispose();
      steelGateMat.dispose();
      railingMat.dispose();
      waterMat.dispose();
      waterBottomFloorMat.dispose();
      contactShadowMat.dispose();

      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[calc(100vh-68px)] overflow-hidden bg-slate-900 select-none">
      {/* 3D WebGL Canvas Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Minimal Top-Left Status Badge (Unobstructed Viewport) */}
      <div className="absolute top-4 left-6 z-20 flex flex-wrap items-center gap-2.5 pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 text-white border border-slate-700/80 shadow-md">
          <Layers className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-bold tracking-tight">3D Acoustic Dam Twin</span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
            Monolith 14
          </span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 text-white border border-slate-700/80 shadow-md">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-slate-200">
            Sound: &ldquo;{whimsicalName}&rdquo;
          </span>
          <span className="text-[10px] font-mono text-slate-400">#{params.seed}</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 text-white border border-slate-700/80 shadow-md">
          <Droplets className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs text-slate-300">
            Head: <strong className="text-white font-mono">{params.hydrostaticHeadM}m</strong>
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-xs text-slate-300">
            Sensor: <strong className="text-white font-mono">{params.sensorDistanceM}m</strong>
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-xs text-sky-300 font-mono">
            Pulse: {pulsePeriodMs}ms
          </span>
        </div>
      </div>

      {/* Top-Right Quick Link to Sound Lab */}
      {onJumpToWorkbench && (
        <div className="absolute top-4 right-6 z-20 pointer-events-auto">
          <button
            type="button"
            onClick={onJumpToWorkbench}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer active:scale-95"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Open Sound Workbench</span>
          </button>
        </div>
      )}

      {/* UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK (Zero Viewport Occlusion) */}
      <div
        className={`absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-full max-w-[min(940px,94vw)] transition-transform duration-300 ease-out pointer-events-auto ${
          dockCollapsed ? 'translate-y-[calc(100%-38px)]' : 'translate-y-0'
        }`}
      >
        {/* Collapse / Expand Toggle Tab */}
        <div className="flex justify-center -mb-[1px]">
          <button
            type="button"
            onClick={() => setDockCollapsed((prev) => !prev)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-t-lg bg-slate-900 text-slate-300 hover:text-white border-t border-x border-slate-700 text-xs font-semibold shadow-md cursor-pointer transition-colors"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
                <span>Show Inspector Controls</span>
                <span className="text-[10px] text-slate-500 font-mono">(H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-sky-400" />
                <span>Hide Controls (Cinema View)</span>
                <span className="text-[10px] text-slate-500 font-mono">(H)</span>
              </>
            )}
          </button>
        </div>

        {/* Main Dock Container: Solid surface (no backdrop-filter over WebGL) */}
        <div className="bg-slate-900 text-slate-100 rounded-xl border border-slate-700/90 shadow-2xl p-4 space-y-3.5">
          {/* Row 1: Camera Preset Buttons & Cutaway Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                <Camera className="w-3.5 h-3.5 text-sky-400" />
                Camera:
              </span>
              {(
                [
                  { id: 'overview', label: 'Dam Overview' },
                  { id: 'hydrophone', label: 'Hydrophone Buoy' },
                  { id: 'leak', label: 'Leak Fissure' },
                  { id: 'spillway', label: 'Crest & Gates' },
                  { id: 'aerial', label: 'Top-Down Aerial' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectCameraPreset(preset.id)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                    activeCamPreset === preset.id
                      ? 'bg-sky-600 text-white font-bold shadow-xs'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Quick Inspection Toggles */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWaterCutaway((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-all cursor-pointer ${
                  waterCutaway
                    ? 'bg-sky-950 border-sky-500 text-sky-300 font-bold'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {waterCutaway ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>Water Cutaway</span>
              </button>

              <button
                type="button"
                onClick={() => setShowAcousticWaves((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-all cursor-pointer ${
                  showAcousticWaves
                    ? 'bg-indigo-950 border-indigo-500 text-indigo-300 font-bold'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Acoustic Waves</span>
              </button>
            </div>
          </div>

          {/* Row 2: Exploded View Slider & Microphone Distance Slider */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Exploded Structural Layers Slider */}
            <div className="bg-slate-800/80 rounded-lg p-2.5 border border-slate-700/60">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  Exploded Structural Layers
                </span>
                <span className="font-mono text-sky-400 font-bold">
                  {(explodedRatio * 100).toFixed(0)}%
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
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>Assembled Monolith</span>
                <span>Separated Components</span>
              </div>
            </div>

            {/* Microphone Distance Control */}
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
                onChange={(e) => onUpdateParam('sensorDistanceM', parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>Near Sensor (Fast Pulse)</span>
                <span>Distant Hydrophone (Slow Attenuated Pulse)</span>
              </div>
            </div>
          </div>

          {/* Row 3: Acoustic Leak Preset Chips */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/80">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
              Leak Presets:
            </span>
            {Object.entries(PRESET_CONFIGS).map(([key, config]) => {
              const isActive = activePresetKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectPreset(key)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-amber-500 border-amber-400 text-slate-950 font-bold shadow-xs'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {config.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
