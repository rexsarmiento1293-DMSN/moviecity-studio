import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ParsedSegmentProgress } from '../utils/renderQueueLogic';

interface RenderCluster3DProps {
  segmentsMap: Record<number, ParsedSegmentProgress>;
  isJobRunning: boolean;
  detectedEncoder: string;
  onTriggerRender: () => void;
}

type CameraPresetId = 'isometric' | 'closeup' | 'topmatrix' | 'manifold';
type FinishPresetId = 'titanium' | 'gold' | 'obsidian';

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; target: [number, number, number]; label: string }
> = {
  isometric: {
    pos: [10.5, 7.8, 12.5],
    target: [0, 2.4, 0],
    label: 'Isometric Rack',
  },
  closeup: {
    pos: [0.0, 3.1, 6.8],
    target: [0, 2.5, 0],
    label: 'Blade Array',
  },
  topmatrix: {
    pos: [0.2, 13.5, 2.8],
    target: [0, 1.8, 0],
    label: 'Top Matrix',
  },
  manifold: {
    pos: [-8.8, 4.2, -7.5],
    target: [0, 2.3, 0],
    label: 'Cooling Manifold',
  },
};

const FINISH_PRESETS: Record<
  FinishPresetId,
  { hullColor: number; metalness: number; roughness: number; accentColor: number; label: string }
> = {
  titanium: {
    hullColor: 0x334155,
    metalness: 0.88,
    roughness: 0.22,
    accentColor: 0x38bdf8,
    label: 'Anodized Titanium',
  },
  gold: {
    hullColor: 0xb48a3e,
    metalness: 0.94,
    roughness: 0.16,
    accentColor: 0xf59e0b,
    label: 'Brushed Gold',
  },
  obsidian: {
    hullColor: 0x111827,
    metalness: 0.78,
    roughness: 0.28,
    accentColor: 0x10b981,
    label: 'Stealth Obsidian',
  },
};

// Pre-allocated scratch math objects outside the animation loop (Zero GC)
const _scratchVec3A = new THREE.Vector3();
const _scratchVec3B = new THREE.Vector3();
const _scratchMat4 = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3(1, 1, 1);
const _scratchColor = new THREE.Color();

function createProceduralGridTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  const step = 64;
  for (let i = 0; i <= 512; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 512, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 16);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function createRadialContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 124);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.32)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const RenderCluster3D: React.FC<RenderCluster3DProps> = ({
  segmentsMap,
  isJobRunning,
  detectedEncoder,
  onTriggerRender,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('isometric');
  const [finishPreset, setFinishPreset] = useState<FinishPresetId>('titanium');
  const [explodeFactor, setExplodeFactor] = useState<number>(0.15);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [selectedSegment, setSelectedSegment] = useState<number>(1);

  // Store mutable state in refs so WebGL scene never tears down on prop/UI updates
  const stateRef = useRef({
    segmentsMap,
    isJobRunning,
    cameraPreset,
    finishPreset,
    explodeFactor,
    activeCameraTransition: true,
    currentExplode: 0.15,
  });

  useEffect(() => {
    stateRef.current.segmentsMap = segmentsMap;
    stateRef.current.isJobRunning = isJobRunning;
    (canvasMountRef.current as any)?.__requestRender?.();
  }, [segmentsMap, isJobRunning]);

  useEffect(() => {
    stateRef.current.cameraPreset = cameraPreset;
    stateRef.current.activeCameraTransition = true;
    (canvasMountRef.current as any)?.__requestRender?.();
  }, [cameraPreset]);

  useEffect(() => {
    stateRef.current.finishPreset = finishPreset;
    (canvasMountRef.current as any)?.__requestRender?.();
  }, [finishPreset]);

  useEffect(() => {
    stateRef.current.explodeFactor = explodeFactor;
    (canvasMountRef.current as any)?.__requestRender?.();
  }, [explodeFactor]);

  // Keyboard shortcut 'H' to toggle HUD drawer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software-WebGL detection from GPU renderer string
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight - 65;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const horizonColor = new THREE.Color(0x0b1120);
    scene.background = horizonColor;
    scene.fog = new THREE.FogExp2(0x0b1120, 0.022);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
    camera.position.set(9.5, 6.8, 11.2);
    camera.lookAt(0, 2.5, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2.5, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 4;
    controls.maxDistance = 28;

    controls.addEventListener('start', () => {
      stateRef.current.activeCameraTransition = false;
    });

    // 3. Studio 3-Point Warm/Cool Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x1e293b, 1.45);
    hemiLight.position.set(0, 18, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 3.2);
    keyLight.position.set(9, 14, 11);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 35;
    const d = 9;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 1.8);
    fillLight.position.set(-10, 9, 8);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
    rimLight.position.set(0, 10, -12);
    scene.add(rimLight);

    // 4. Ground Floor + Coplanar Offset Contact Shadow
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const gridTex = createProceduralGridTexture(maxAniso);
    const floorGeo = new THREE.PlaneGeometry(48, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: gridTex,
      roughness: 0.7,
      metalness: 0.15,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = !isSoftwareGl;
    scene.add(floorMesh);

    const shadowTex = createRadialContactShadowTexture();
    const shadowPlaneGeo = new THREE.PlaneGeometry(11.5, 8.5);
    const shadowPlaneMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const contactShadow = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.015;
    scene.add(contactShadow);

    // 5. Composite 3-12 Part Procedural Marilag Render Cluster (THREE.Group)
    const clusterGroup = new THREE.Group();
    clusterGroup.position.set(0, 0, 0);
    scene.add(clusterGroup);

    // Shared PBR Materials (calibrated for both GPU and software WebGL)
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: isSoftwareGl ? 0.25 : 0.82,
      roughness: 0.28,
    });

    const matteFrameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: isSoftwareGl ? 0.2 : 0.45,
      roughness: 0.55,
    });

    const copperManifoldMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0x78350f,
      emissiveIntensity: 0.25,
      metalness: isSoftwareGl ? 0.25 : 0.88,
      roughness: 0.22,
    });

    const turbineBladeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: isSoftwareGl ? 0.25 : 0.85,
      roughness: 0.22,
    });

    const glassCanopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x7dd3fc,
      metalness: 0.05,
      roughness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.88,
      transparent: true,
      opacity: isSoftwareGl ? 0.32 : 1.0,
      ior: 1.52,
      thickness: 0.5,
      depthWrite: false,
    });

    // Part 1 (Primary Silhouette): Beveled Extruded Rack Base Plinth
    const plinthShape = new THREE.Shape();
    const pw = 3.8;
    const pd = 2.4;
    plinthShape.moveTo(-pw, -pd);
    plinthShape.lineTo(pw, -pd);
    plinthShape.lineTo(pw, pd);
    plinthShape.lineTo(-pw, pd);
    plinthShape.closePath();

    const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, {
      depth: 0.36,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 3,
    });
    plinthGeo.rotateX(-Math.PI / 2);
    const plinthMesh = new THREE.Mesh(plinthGeo, hullMat);
    plinthMesh.position.y = 0.06;
    plinthMesh.castShadow = !isSoftwareGl;
    plinthMesh.receiveShadow = !isSoftwareGl;
    clusterGroup.add(plinthMesh);

    // Part 2: 4 Corner Structural Pillars
    const pillarGeo = new THREE.BoxGeometry(0.28, 4.6, 0.28);
    const pillarOffsets: [number, number][] = [
      [-3.5, -2.1],
      [3.5, -2.1],
      [-3.5, 2.1],
      [3.5, 2.1],
    ];
    const leftWingGroup = new THREE.Group();
    const rightWingGroup = new THREE.Group();
    clusterGroup.add(leftWingGroup);
    clusterGroup.add(rightWingGroup);

    pillarOffsets.forEach(([px, pz]) => {
      const pillar = new THREE.Mesh(pillarGeo, hullMat);
      pillar.position.set(px, 2.66, pz);
      pillar.castShadow = !isSoftwareGl;
      if (px < 0) leftWingGroup.add(pillar);
      else rightWingGroup.add(pillar);
    });

    // Part 3 (Secondary Read): Top Beveled Crown Canopy
    const crownGroup = new THREE.Group();
    const crownMesh = new THREE.Mesh(plinthGeo, hullMat);
    crownMesh.position.y = 4.95;
    crownMesh.castShadow = !isSoftwareGl;
    crownGroup.add(crownMesh);

    // Part 4 (Accent Detail): Optical Glass Top Inspection Window
    const glassGeo = new THREE.BoxGeometry(6.4, 0.08, 3.8);
    const glassMesh = new THREE.Mesh(glassGeo, glassCanopyMat);
    glassMesh.position.set(0, 5.38, 0);
    glassMesh.renderOrder = 10;
    crownGroup.add(glassMesh);
    clusterGroup.add(crownGroup);

    // Part 5 & 6 (Secondary Read): Dual Axial Cooling Turbines using LatheGeometry
    const lathePoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.85, 0.0),
      new THREE.Vector2(0.95, 0.12),
      new THREE.Vector2(0.78, 0.34),
      new THREE.Vector2(0.32, 0.42),
      new THREE.Vector2(0.0, 0.45),
    ];
    const turbineGeo = new THREE.LatheGeometry(lathePoints, 24);
    turbineGeo.rotateX(Math.PI / 2);

    const turbines: THREE.Mesh[] = [];
    [-1.85, 1.85].forEach((tx) => {
      const tMesh = new THREE.Mesh(turbineGeo, turbineBladeMat);
      tMesh.position.set(tx, 2.65, -2.28);
      crownGroup.add(tMesh);
      turbines.push(tMesh);
    });

    // Part 7 & 8 (Secondary Read): Copper Heat-Pipe Cooling Manifolds using TubeGeometry
    const manifoldGroup = new THREE.Group();
    [-2.6, -0.9, 0.9, 2.6].forEach((mx) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(mx, 0.4, -2.0),
        new THREE.Vector3(mx, 1.6, -2.35),
        new THREE.Vector3(mx, 3.8, -2.35),
        new THREE.Vector3(mx, 4.9, -1.8),
      ]);
      const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.075, 12, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, copperManifoldMat);
      manifoldGroup.add(tubeMesh);
    });
    clusterGroup.add(manifoldGroup);

    // Part 9: 24 Individual GPU Segment Blades (6 columns x 4 rows = 24 segments)
    const bladeBodyGeo = new THREE.BoxGeometry(0.86, 0.72, 2.8);
    const bladeBezelGeo = new THREE.BoxGeometry(0.76, 0.58, 0.12);

    interface BladeNode {
      segmentNumber: number;
      group: THREE.Group;
      basePos: THREE.Vector3;
      statusMat: THREE.MeshStandardMaterial;
      barMesh: THREE.Mesh;
    }

    const bladeNodes: BladeNode[] = [];
    const barGeo = new THREE.BoxGeometry(0.66, 0.1, 0.06);

    for (let idx = 0; idx < 24; idx++) {
      const col = idx % 6;
      const row = Math.floor(idx / 6);

      const bx = (col - 2.5) * 1.08;
      const by = 1.02 + row * 1.02;
      const bz = 0;

      const bGroup = new THREE.Group();
      bGroup.position.set(bx, by, bz);

      const body = new THREE.Mesh(bladeBodyGeo, matteFrameMat);
      body.castShadow = !isSoftwareGl;
      body.receiveShadow = !isSoftwareGl;
      bGroup.add(body);

      const statusMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.45,
        roughness: 0.25,
        metalness: 0.5,
      });

      const frontBezel = new THREE.Mesh(bladeBezelGeo, statusMat);
      frontBezel.position.set(0, 0, 1.42);
      bGroup.add(frontBezel);

      const barMesh = new THREE.Mesh(barGeo, copperManifoldMat);
      barMesh.position.set(0, -0.22, 1.49);
      bGroup.add(barMesh);

      clusterGroup.add(bGroup);
      bladeNodes.push({
        segmentNumber: idx + 1,
        group: bGroup,
        basePos: new THREE.Vector3(bx, by, bz),
        statusMat,
        barMesh,
      });
    }

    // Part 10: InstancedMesh for 96 Anodized Heatsink Fins (>20 repeated items)
    const finCount = 96;
    const finGeo = new THREE.BoxGeometry(0.04, 0.24, 2.4);
    const finMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.3,
    });
    const finInstanced = new THREE.InstancedMesh(finGeo, finMat, finCount);
    for (let i = 0; i < finCount; i++) {
      const bladeIdx = Math.floor(i / 4);
      const localFin = i % 4;
      const col = bladeIdx % 6;
      const row = Math.floor(bladeIdx / 6);
      const fx = (col - 2.5) * 1.08 + (localFin - 1.5) * 0.18;
      const fy = 1.02 + row * 1.02 + 0.42;
      _scratchPos.set(fx, fy, 0);
      _scratchQuat.identity();
      _scratchScale.set(1, 1, 1);
      _scratchMat4.compose(_scratchPos, _scratchQuat, _scratchScale);
      finInstanced.setMatrixAt(i, _scratchMat4);
      _scratchColor.setHSL(0.58, 0.18, 0.45 + (i % 3) * 0.05);
      finInstanced.setColorAt(i, _scratchColor);
    }
    finInstanced.instanceMatrix.needsUpdate = true;
    if (finInstanced.instanceColor) finInstanced.instanceColor.needsUpdate = true;
    finInstanced.computeBoundingSphere();
    clusterGroup.add(finInstanced);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 6. Frame-rate independent animation loop using performance.now() (no deprecated THREE.Clock)
    const startTimeMs = performance.now();
    let lastTimeMs = startTimeMs;
    let frameId = 0;
    let isDisposed = false;
    let renderBusy = false;
    let renderDirty = false;
    let envInitialized = false;

    function getTiming(): { dt: number; elapsed: number } {
      const nowMs = performance.now();
      const rawDt = Math.max(0.001, (nowMs - lastTimeMs) / 1000);
      lastTimeMs = nowMs;
      return {
        dt: Math.min(rawDt, 0.1),
        elapsed: (nowMs - startTimeMs) / 1000,
      };
    }

    function afterDraw(cb: () => void) {
      if (isDisposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (sync && state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateSceneState(dt: number, elapsed: number) {
      const st = stateRef.current;

      if (!envInitialized) {
        envInitialized = true;
        if (!isSoftwareGl) {
          const pmremGen = new THREE.PMREMGenerator(renderer);
          scene.environment = pmremGen.fromScene(new RoomEnvironment(), 0.04).texture;
          pmremGen.dispose();
        }
      }

      const finish = FINISH_PRESETS[st.finishPreset];
      hullMat.color.setHex(finish.hullColor);
      hullMat.metalness = isSoftwareGl ? 0.25 : finish.metalness;
      hullMat.roughness = finish.roughness;

      st.currentExplode = THREE.MathUtils.damp(
        st.currentExplode,
        st.explodeFactor,
        8,
        dt
      );
      const exp = st.currentExplode;
      crownGroup.position.y = exp * 1.65;
      leftWingGroup.position.x = -exp * 1.1;
      rightWingGroup.position.x = exp * 1.1;
      manifoldGroup.position.z = -exp * 1.3;

      const spinSpeed = st.isJobRunning ? 8.0 : 1.8;
      for (const t of turbines) {
        t.rotation.z += dt * spinSpeed;
      }

      for (const node of bladeNodes) {
        const seg = st.segmentsMap[node.segmentNumber];
        const zPull = exp * 0.55 * ((node.segmentNumber % 2 === 0 ? 1 : -1) * 0.4 + 0.6);
        node.group.position.set(
          node.basePos.x * (1 + exp * 0.18),
          node.basePos.y + exp * 0.25,
          node.basePos.z + zPull
        );

        if (seg) {
          if (seg.success) {
            node.statusMat.color.setHex(0x10b981);
            node.statusMat.emissive.setHex(0x059669);
            node.statusMat.emissiveIntensity = 0.75;
          } else {
            node.statusMat.color.setHex(0xef4444);
            node.statusMat.emissive.setHex(0xdc2626);
            node.statusMat.emissiveIntensity = 0.9;
          }
        } else if (st.isJobRunning) {
          const wave = 0.5 + 0.5 * Math.sin(elapsed * 5 + node.segmentNumber * 0.4);
          node.statusMat.color.setHex(0xf59e0b);
          node.statusMat.emissive.setHex(0xd97706);
          node.statusMat.emissiveIntensity = 0.35 + wave * 0.6;
        } else {
          node.statusMat.color.setHex(finish.accentColor);
          node.statusMat.emissive.setHex(finish.accentColor);
          node.statusMat.emissiveIntensity = 0.28;
        }
      }

      if (st.activeCameraTransition) {
        const preset = CAMERA_PRESETS[st.cameraPreset];
        _scratchVec3A.set(...preset.pos);
        _scratchVec3B.set(...preset.target);

        const dampAlpha = isSoftwareGl ? 1.0 : 1 - Math.exp(-6.5 * dt);
        camera.position.lerp(_scratchVec3A, dampAlpha);
        controls.target.lerp(_scratchVec3B, dampAlpha);

        if (
          camera.position.distanceToSquared(_scratchVec3A) < 0.005 &&
          controls.target.distanceToSquared(_scratchVec3B) < 0.005
        ) {
          st.activeCameraTransition = false;
        }
      }
    }

    function requestRender() {
      if (isDisposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (isDisposed) return;
        renderDirty = false;
        const { dt, elapsed } = getTiming();
        updateSceneState(dt, elapsed);
        controls.update();
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty || stateRef.current.activeCameraTransition) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    function tickGpu() {
      if (isDisposed) return;
      const { dt, elapsed } = getTiming();
      updateSceneState(dt, elapsed);
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tickGpu);
    }

    controls.addEventListener('change', () => {
      if (isSoftwareGl) requestRender();
    });

    (container as any).__requestRender = requestRender;

    if (isSoftwareGl) {
      requestRender();
    } else {
      frameId = requestAnimationFrame(tickGpu);
    }

    const handleResize = () => {
      if (!container || isDisposed) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight - 65;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  const completedSegments = Object.values(segmentsMap).filter((s) => s.success).length;
  const activeSegInfo = segmentsMap[selectedSegment];

  return (
    <section
      aria-label="3D Render Cluster Viewport"
      className="relative w-full h-[calc(100vh-65px)] bg-[#090d16] overflow-hidden select-none"
    >
      {/* Dedicated WebGL Mount Container outside React HUD overlays */}
      <div
        ref={canvasMountRef}
        data-testid="threejs-cluster-canvas"
        className="w-full h-full"
      />

      {/* Minimal Top-Left Spec Telemetry Overlay (Solid RGBA, no backdrop-filter over WebGL) */}
      <div className="
        pointer-events-auto absolute top-4 left-6 z-10
        bg-[#0f172a]/95 border border-slate-800 rounded-lg px-4 py-3
        max-w-md
      ">
        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
          <span>MARILAG 24-BLADE CLUSTER</span>
          <span aria-hidden="true">·</span>
          <span>ENCODER: {detectedEncoder.toUpperCase()}</span>
          <span aria-hidden="true">·</span>
          <span>{completedSegments}/24 READY</span>
        </div>
        <h2 className="text-base font-semibold text-slate-100 mt-1">
          24-Segment Parallel FFmpeg Compute Rack
        </h2>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-300 font-mono tabular-nums">
          <label htmlFor="blade-inspector-select" className="text-slate-400">
            Inspect Blade:
          </label>
          <select
            id="blade-inspector-select"
            value={selectedSegment}
            onChange={(e) => setSelectedSegment(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((num) => (
              <option key={num} value={num}>
                Segment #{String(num).padStart(2, '0')}
              </option>
            ))}
          </select>
          <span>
            {activeSegInfo
              ? `${activeSegInfo.elapsedSec.toFixed(2)}s · ${activeSegInfo.sizeKb} KB`
              : 'Standby'}
          </span>
        </div>
      </div>

      {/* Unified Collapsible Bottom Control Dock (Zero Side-Panel Clutter, <= 15% Viewport) */}
      <div
        style={{
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: 'min(940px, 94vw)',
        }}
        className="pointer-events-auto absolute z-10 w-full flex flex-col items-center"
      >
        <button
          type="button"
          onClick={() => setDockCollapsed((prev) => !prev)}
          className="
            px-3.5 py-1 text-xs font-medium text-slate-200
            bg-[#0f172a] border border-b-0 border-slate-700 rounded-t-lg
            hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0
          "
        >
          {dockCollapsed ? '▴ Show Controls (H)' : '▾ Hide Controls (H)'}
        </button>

        {!dockCollapsed && (
          <div className="
            w-full bg-[#0f172a]/95 border border-slate-700 rounded-xl px-5 py-3.5
            flex flex-wrap items-center justify-between gap-4 shadow-2xl
          ">
            {/* Exploded View Slider */}
            <div className="flex items-center gap-3">
              <label
                htmlFor="exploded-view-slider"
                className="text-xs font-medium text-slate-300 whitespace-nowrap shrink-0"
              >
                Exploded View
              </label>
              <input
                id="exploded-view-slider"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={explodeFactor}
                onChange={(e) => setExplodeFactor(parseFloat(e.target.value))}
                className="w-28 accent-sky-400 cursor-pointer"
              />
              <span className="text-xs font-mono tabular-nums text-slate-400 w-9">
                {Math.round(explodeFactor * 100)}%
              </span>
            </div>

            {/* Camera View Presets */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((presetKey) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => setCameraPreset(presetKey)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    cameraPreset === presetKey
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {CAMERA_PRESETS[presetKey].label}
                </button>
              ))}
            </div>

            {/* Material Finish Selector */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              {(Object.keys(FINISH_PRESETS) as FinishPresetId[]).map((finishKey) => (
                <button
                  key={finishKey}
                  type="button"
                  onClick={() => setFinishPreset(finishKey)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    finishPreset === finishKey
                      ? 'bg-slate-200 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {FINISH_PRESETS[finishKey].label}
                </button>
              ))}
            </div>

            {/* Trigger Live Render Action */}
            <button
              type="button"
              onClick={onTriggerRender}
              disabled={isJobRunning}
              className="
                px-3.5 py-1.5 text-xs font-semibold rounded-lg
                bg-amber-500 text-slate-950 hover:bg-amber-400
                disabled:opacity-50 transition-colors whitespace-nowrap shrink-0
              "
            >
              {isJobRunning ? 'Rendering 24 Segments...' : 'Dispatch Render Job'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
