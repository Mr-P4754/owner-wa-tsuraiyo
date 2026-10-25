/**
 * tower3d.js
 * Three.js を用いたリアルタイム3Dビルディング描画・季節パーティクル・カメラ操作・レイキャスト制御モジュール
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { getState } from '../state.js';
import { showFloorDetailModal, showTroubleDetailModal } from './modal.js';
import { getCharacterAvatar, getMoodEmoji } from './renderDashboard.js';

/** Three.js シングルトン管理オブジェクト */
let scene = null;
let camera = null;
let renderer = null;
let containerEl = null;
let labelsContainerEl = null;
let emergencyFlashOverlayEl = null;
let emergencyAlertBtnEl = null;
let onStateChangedCallback = null;

/** 3Dオブジェクト参照 */
let buildingGroup = null;
const floorMeshes = []; // Raycaster対象となる各階のヒットボックスメッシュ配列
const floorVisuals = {}; // floorNumber -> { glassMat, interiorMat, frameMat, alertRing, eventRing, labelEl, group, yPos }
const treeFoliageMeshes = []; // 季節で色が変わる街路樹の葉メッシュ
let particleSystem = null;
let particleVelocities = [];
let roofBeaconLight = null;
let roofRadarMesh = null;
let ambientLight = null;
let dirLight = null;
let hemiLight = null;

/** カメラオービット制御用パラメーター */
let baseCameraAngleY = 0.52; // プレイヤー操作基準の水平回転角（ラジアン）
let cameraAngleY = 0.52; // 描画用の水平回転角（ラジアン）
let cameraElevation = 11.5; // カメラ高さ
let cameraDistance = 24.5; // カメラ距離（ズーム）
const cameraTarget = new THREE.Vector3(0, 8.2, 0);

/** ポインター・マルチタッチ（ピンチイン・ピンチアウト）操作状態 */
let isDragging = false;
let pointerDownPos = { x: 0, y: 0 };
let prevPointerPos = { x: 0, y: 0 };
let maxMoveDistance = 0;
let wasMultiTouch = false;
let lastPinchDistance = null;
let lastPinchMidY = null;
let lastGestureEndTime = 0;
const activePointers = new Map(); // pointerId -> { x, y }
let hoveredFloorNumber = null;
let currentSeasonIndex = -1;

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

/** 1フロアあたりの高さ設定 */
const FLOOR_HEIGHT = 1.42;
const BASE_Y = 1.2;

/**
 * 季節ごとの3D空間テーマ（背景・ライト・木々の色・パーティクル色）
 */
const SEASON_3D_THEMES = [
  // 0: 春（桜と柔らかい陽射し）
  {
    skyTop: '#1e3a8a',
    skyMid: '#38bdf8',
    skyBottom: '#fbcfe8',
    ambientColor: 0xffe4e6,
    ambientIntensity: 0.75,
    dirColor: 0xfffbeb,
    dirIntensity: 1.35,
    foliageColor: 0xf472b6, // 桜ピンク
    particleColor: 0xfbcfe8,
    particleSize: 0.22,
  },
  // 1: 夏（快晴の青空と新緑）
  {
    skyTop: '#0369a1',
    skyMid: '#0ea5e9',
    skyBottom: '#bae6fd',
    ambientColor: 0xe0f2fe,
    ambientIntensity: 0.85,
    dirColor: 0xffffff,
    dirIntensity: 1.55,
    foliageColor: 0x10b981, // 新緑グリーン
    particleColor: 0xfef08a,
    particleSize: 0.16,
  },
  // 2: 秋（夕焼けと紅葉）
  {
    skyTop: '#431407',
    skyMid: '#c2410c',
    skyBottom: '#fde047',
    ambientColor: 0xffedd5,
    ambientIntensity: 0.7,
    dirColor: 0xfb923c,
    dirIntensity: 1.4,
    foliageColor: 0xea580c, // 紅葉オレンジ
    particleColor: 0xf97316,
    particleSize: 0.22,
  },
  // 3: 冬（星空・トワイライトと雪）
  {
    skyTop: '#090d16',
    skyMid: '#1e1b4b',
    skyBottom: '#3b82f6',
    ambientColor: 0x93c5fd,
    ambientIntensity: 0.6,
    dirColor: 0xbfdbfe,
    dirIntensity: 1.1,
    foliageColor: 0xe2e8f0, // 雪化粧ホワイト
    particleColor: 0xffffff,
    particleSize: 0.2,
  },
];

/**
 * 3Dビルビューアを初期化する
 * @param {string} containerId 描画先コンテナ要素のID
 * @param {Function} onStateChanged 状態更新時のコールバック
 */
export function initTower3D(containerId, onStateChanged) {
  onStateChangedCallback = onStateChanged;
  containerEl = document.getElementById(containerId);
  if (!containerEl) return;

  // 既に初期化済みの場合は状態同期のみ行う
  if (renderer) {
    handleResize();
    updateTower3DFromState();
    return;
  }

  containerEl.innerHTML = '';

  // 緊急大規模改修発生時の半透明赤↔透明フェード点滅オーバーレイ
  emergencyFlashOverlayEl = document.createElement('div');
  emergencyFlashOverlayEl.className = 'tower3d-emergency-flash-overlay hidden';
  containerEl.appendChild(emergencyFlashOverlayEl);

  // 緊急大規模改修発生時の「大規模トラブル発生！」アクションボタン
  emergencyAlertBtnEl = document.createElement('button');
  emergencyAlertBtnEl.type = 'button';
  emergencyAlertBtnEl.className = 'tower3d-emergency-btn hidden';
  emergencyAlertBtnEl.innerHTML = `<span>🚨 大規模トラブル発生！</span>`;
  emergencyAlertBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const st = getState();
    const emTrouble = st.troubles.find((t) => t.isEmergencyRepair);
    if (emTrouble && onStateChangedCallback) {
      showTroubleDetailModal(emTrouble.id, onStateChangedCallback);
    }
  });
  containerEl.appendChild(emergencyAlertBtnEl);

  // 3D追従ラベル用のオーバーレイコンテナを生成
  labelsContainerEl = document.createElement('div');
  labelsContainerEl.className = 'tower3d-labels-layer';
  containerEl.appendChild(labelsContainerEl);

  // シーン作成
  scene = new THREE.Scene();

  // カメラ作成
  const width = containerEl.clientWidth || 600;
  const height = containerEl.clientHeight || 600;
  camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 150);
  updateCameraPosition();

  // レンダラー作成
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = 'tower3d-canvas';
  containerEl.insertBefore(renderer.domElement, labelsContainerEl);

  // ライティング構築
  setupLights();

  // ビル・地面・街並み・パーティクルの構築
  buildCityEnvironment();
  buildTowerModel();
  buildSeasonParticles();

  // ポインター・リサイズイベント登録
  bindInteractionEvents(renderer.domElement);
  window.addEventListener('resize', handleResize);

  // 初回状態反映＆アニメーションループ開始
  updateTower3DFromState();
  requestAnimationFrame(animateLoop);
}

/**
 * ライティングをセットアップする
 */
function setupLights() {
  ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x1e293b, 0.55);
  hemiLight.position.set(0, 30, 0);
  scene.add(hemiLight);

  dirLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
  dirLight.position.set(16, 28, 18);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 5;
  dirLight.shadow.camera.far = 65;
  const d = 14;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d + 6;
  dirLight.shadow.camera.bottom = -d;
  scene.add(dirLight);

  // ビル背面からのリムライト（立体感を強調）
  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
  rimLight.position.set(-14, 15, -12);
  scene.add(rimLight);
}

/**
 * 地面・道路・街路樹・街灯の3D環境を構築する
 */
function buildCityEnvironment() {
  const envGroup = new THREE.Group();

  // 1. 都市ブロック台座
  const baseGeo = new THREE.CylinderGeometry(11.5, 12.2, 0.8, 32);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.8,
    metalness: 0.2,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = -0.4;
  baseMesh.receiveShadow = true;
  envGroup.add(baseMesh);

  // 2. 敷地タイル広場
  const plazaGeo = new THREE.BoxGeometry(11.6, 0.16, 9.6);
  const plazaMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.6,
    metalness: 0.1,
  });
  const plazaMesh = new THREE.Mesh(plazaGeo, plazaMat);
  plazaMesh.position.y = 0.08;
  plazaMesh.receiveShadow = true;
  envGroup.add(plazaMesh);

  // 3. エントランスアプローチ（レッドカーペット風タイル）
  const pathGeo = new THREE.BoxGeometry(2.6, 0.19, 3.8);
  const pathMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    roughness: 0.7,
  });
  const pathMesh = new THREE.Mesh(pathGeo, pathMat);
  pathMesh.position.set(0, 0.09, 3.4);
  envGroup.add(pathMesh);

  // 4. 街路樹の配置（季節で葉の色が変化）
  const treePositions = [
    [-4.3, 3.5],
    [4.3, 3.5],
    [-4.6, -2.8],
    [4.6, -2.8],
    [-2.4, 4.1],
    [2.4, 4.1],
  ];

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.9, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const foliageGeo = new THREE.DodecahedronGeometry(0.68, 1);

  for (const [tx, tz] of treePositions) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.45;
    trunk.castShadow = true;
    tree.add(trunk);

    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0xf472b6,
      roughness: 0.6,
    });
    const foliage = new THREE.Mesh(foliageGeo, foliageMat);
    foliage.position.y = 1.15;
    foliage.castShadow = true;
    tree.add(foliage);
    treeFoliageMeshes.push(foliage);

    tree.position.set(tx, 0.15, tz);
    envGroup.add(tree);
  }

  scene.add(envGroup);
}

/**
 * 10階建てビル本体の3Dモデル（基壇＋1F〜10F＋屋上）を構築する
 */
function buildTowerModel() {
  buildingGroup = new THREE.Group();
  floorMeshes.length = 0;

  // --- 1階エントランスロビー基壇 ---
  const lobbyGeo = new THREE.BoxGeometry(6.8, BASE_Y, 5.2);
  const lobbyMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.4,
    metalness: 0.5,
  });
  const lobbyMesh = new THREE.Mesh(lobbyGeo, lobbyMat);
  lobbyMesh.position.y = BASE_Y / 2;
  lobbyMesh.castShadow = true;
  lobbyMesh.receiveShadow = true;
  buildingGroup.add(lobbyMesh);

  // エントランスガラス扉（発光）
  const doorGeo = new THREE.BoxGeometry(2.2, BASE_Y * 0.8, 0.15);
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.65,
    roughness: 0.2,
  });
  const doorMesh = new THREE.Mesh(doorGeo, doorMat);
  doorMesh.position.set(0, BASE_Y * 0.4, 2.61);
  buildingGroup.add(doorMesh);

  // エントランスキャノピー（庇）
  const canopyGeo = new THREE.BoxGeometry(3.2, 0.16, 1.4);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.6, roughness: 0.3 });
  const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
  canopyMesh.position.set(0, BASE_Y * 0.92, 3.1);
  buildingGroup.add(canopyMesh);

  // --- 1階〜10階の各フロア3D構築 ---
  const state = getState();
  const totalFloors = state.totalFloors || 10;

  for (let floorNum = 1; floorNum <= totalFloors; floorNum++) {
    const floorGroup = new THREE.Group();
    const yCenter = BASE_Y + (floorNum - 0.5) * FLOOR_HEIGHT;
    floorGroup.position.y = yCenter;

    const isLow = floorNum <= 5;
    const isMid = floorNum >= 6 && floorNum <= 8;
    const isHigh = floorNum >= 9;

    // 階層ごとにビルの幅・奥行きやデザインに変化をつける
    const width = isHigh ? 5.8 : isMid ? 6.3 : 6.6;
    const depth = isHigh ? 4.4 : isMid ? 4.8 : 5.0;

    // 1. フロア床・天井スラブ（階層カラーの縁取り）
    const slabColor = isHigh ? 0x7e22ce : isMid ? 0x1d4ed8 : 0x047857;
    const slabGeo = new THREE.BoxGeometry(width + 0.22, 0.16, depth + 0.22);
    const frameMat = new THREE.MeshStandardMaterial({
      color: slabColor,
      roughness: 0.35,
      metalness: 0.45,
    });
    const bottomSlab = new THREE.Mesh(slabGeo, frameMat);
    bottomSlab.position.y = -FLOOR_HEIGHT / 2 + 0.08;
    bottomSlab.castShadow = true;
    bottomSlab.receiveShadow = true;
    floorGroup.add(bottomSlab);

    // 2. 室内発光コア（入居時に明るく光る内部ブロック）
    const interiorGeo = new THREE.BoxGeometry(width - 0.35, FLOOR_HEIGHT - 0.2, depth - 0.35);
    const interiorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.5,
    });
    const interiorMesh = new THREE.Mesh(interiorGeo, interiorMat);
    floorGroup.add(interiorMesh);

    // 3. 窓ガラス外装（Raycasterのヒット対象メッシュ）
    const glassGeo = new THREE.BoxGeometry(width, FLOOR_HEIGHT - 0.16, depth);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0.72,
      roughness: 0.15,
      metalness: 0.25,
      reflectivity: 0.9,
    });
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.userData = { floorNumber: floorNum };
    glassMesh.castShadow = true;
    glassMesh.receiveShadow = true;
    floorGroup.add(glassMesh);
    floorMeshes.push(glassMesh);

    // 4. 四隅の柱マリオン（建築ディテール）
    const pillarGeo = new THREE.BoxGeometry(0.24, FLOOR_HEIGHT, 0.24);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: isHigh ? 0xfbbf24 : 0x475569,
      metalness: isHigh ? 0.8 : 0.4,
      roughness: 0.3,
    });
    const corners = [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [-width / 2, depth / 2],
      [width / 2, depth / 2],
    ];
    for (const [cx, cz] of corners) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(cx, 0, cz);
      floorGroup.add(pillar);
    }

    // 低層階には正面バルコニー手すりを追加
    if (isLow) {
      const balconyGeo = new THREE.BoxGeometry(width * 0.75, 0.32, 0.18);
      const balconyMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5 });
      const balcony = new THREE.Mesh(balconyGeo, balconyMat);
      balcony.position.set(0, -FLOOR_HEIGHT * 0.22, depth / 2 + 0.12);
      floorGroup.add(balcony);
    }

    // 5. トラブル発生時の赤色3D警告リング
    const alertRingGeo = new THREE.TorusGeometry(width * 0.65, 0.09, 8, 32);
    const alertRingMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const alertRing = new THREE.Mesh(alertRingGeo, alertRingMat);
    alertRing.rotation.x = Math.PI / 2;
    alertRing.visible = false;
    floorGroup.add(alertRing);

    // 6. 退去・家賃交渉発生時のゴールド3Dリング
    const eventRingGeo = new THREE.TorusGeometry(width * 0.63, 0.07, 8, 32);
    const eventRingMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const eventRing = new THREE.Mesh(eventRingGeo, eventRingMat);
    eventRing.rotation.x = Math.PI / 2;
    eventRing.visible = false;
    floorGroup.add(eventRing);

    // 7. 3D座標に追従するフローティングHTMLラベル要素を生成
    const labelEl = document.createElement('div');
    labelEl.className = 'tower3d-floor-label';
    labelEl.addEventListener('click', (e) => {
      e.stopPropagation();
      // ピンチ操作中・ドラッグ操作直後の誤タップ発火を防止
      if (
        wasMultiTouch ||
        activePointers.size >= 2 ||
        maxMoveDistance >= 8 ||
        performance.now() - lastGestureEndTime < 280
      ) {
        return;
      }
      const currentState = getState();
      const targetFloor = currentState.floors.find((f) => f.floorNumber === floorNum);
      if (targetFloor && onStateChangedCallback) {
        showFloorDetailModal(targetFloor, onStateChangedCallback);
      }
    });
    labelsContainerEl.appendChild(labelEl);

    floorVisuals[floorNum] = {
      group: floorGroup,
      glassMesh,
      glassMat,
      interiorMat,
      frameMat,
      alertRing,
      eventRing,
      labelEl,
      yPos: yCenter,
      halfWidth: width / 2,
    };

    buildingGroup.add(floorGroup);
  }

  // --- 屋上構造物（ペントハウスクラウン・ヘリポート・アンテナ） ---
  const roofY = BASE_Y + totalFloors * FLOOR_HEIGHT;
  const roofGroup = new THREE.Group();
  roofGroup.position.y = roofY;

  const crownGeo = new THREE.BoxGeometry(6.1, 0.35, 4.7);
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.6,
    roughness: 0.3,
  });
  const crownMesh = new THREE.Mesh(crownGeo, crownMat);
  crownMesh.position.y = 0.17;
  roofGroup.add(crownMesh);

  // 屋上機械室＆ヘリポートサークル
  const heliPadGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.12, 24);
  const heliPadMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
  const heliPad = new THREE.Mesh(heliPadGeo, heliPadMat);
  heliPad.position.set(-0.8, 0.4, 0);
  roofGroup.add(heliPad);

  // 屋上電波塔・回転レーダー
  const mastGeo = new THREE.CylinderGeometry(0.06, 0.12, 2.2, 8);
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.position.set(1.8, 1.3, -1.0);
  roofGroup.add(mast);

  const radarGeo = new THREE.BoxGeometry(0.9, 0.18, 0.12);
  const radarMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.5 });
  roofRadarMesh = new THREE.Mesh(radarGeo, radarMat);
  roofRadarMesh.position.set(1.8, 2.1, -1.0);
  roofGroup.add(roofRadarMesh);

  // 航空障害灯（赤色点滅ビーコン）
  const beaconGeo = new THREE.SphereGeometry(0.14, 12, 12);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff1744 });
  const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
  beaconMesh.position.set(1.8, 2.5, -1.0);
  roofGroup.add(beaconMesh);

  roofBeaconLight = new THREE.PointLight(0xff1744, 1.5, 8);
  roofBeaconLight.position.set(1.8, 2.5, -1.0);
  roofGroup.add(roofBeaconLight);

  buildingGroup.add(roofGroup);
  scene.add(buildingGroup);
}

/**
 * 季節を彩る3Dパーティクル（桜・光粒子・紅葉・雪）を構築する
 */
function buildSeasonParticles() {
  const count = 180;
  const positions = new Float32Array(count * 3);
  particleVelocities = [];

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 24;
    positions[i * 3 + 1] = Math.random() * 22;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
    particleVelocities.push({
      vx: (Math.random() - 0.5) * 0.025,
      vy: -(0.02 + Math.random() * 0.035),
      vz: (Math.random() - 0.5) * 0.025,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xfbcfe8,
    size: 0.22,
    transparent: true,
    opacity: 0.85,
  });

  particleSystem = new THREE.Points(geo, mat);
  scene.add(particleSystem);
}

/**
 * ゲーム状態（state）を3Dモデルのマテリアル・照明・HTMLラベルへ反映する
 */
export function updateTower3DFromState() {
  if (!scene) return;
  const state = getState();

  // 1. 季節テーマの反映
  if (currentSeasonIndex !== state.seasonIndex) {
    currentSeasonIndex = state.seasonIndex;
    const theme = SEASON_3D_THEMES[currentSeasonIndex] || SEASON_3D_THEMES[0];

    if (ambientLight) {
      ambientLight.color.setHex(theme.ambientColor);
      ambientLight.intensity = theme.ambientIntensity;
    }
    if (dirLight) {
      dirLight.color.setHex(theme.dirColor);
      dirLight.intensity = theme.dirIntensity;
    }
    for (const foliage of treeFoliageMeshes) {
      foliage.material.color.setHex(theme.foliageColor);
    }
    if (particleSystem) {
      particleSystem.material.color.setHex(theme.particleColor);
      particleSystem.material.size = theme.particleSize;
    }
  }

  // 2. 各フロアの入居状態・照明・トラブル・イベントバッジの反映
  const troubleCountMap = new Map();
  let emergencyTrouble = null;
  for (const t of state.troubles) {
    if (t.isEmergencyRepair) {
      emergencyTrouble = t;
    } else {
      troubleCountMap.set(t.floorNumber, (troubleCountMap.get(t.floorNumber) || 0) + 1);
    }
  }
  const hasEmergencyRepair = Boolean(emergencyTrouble);

  // 緊急大規模改修が発生している場合はビル断面を半透明赤↔透明でフェード点滅させ、画面内ボタンを表示
  if (emergencyFlashOverlayEl) {
    emergencyFlashOverlayEl.classList.toggle('hidden', !hasEmergencyRepair);
  }
  if (emergencyAlertBtnEl) {
    emergencyAlertBtnEl.classList.toggle('hidden', !hasEmergencyRepair);
  }

  for (const floor of state.floors) {
    const vis = floorVisuals[floor.floorNumber];
    if (!vis) continue;

    const isVacant = floor.tenant === null;
    const troubleCount = troubleCountMap.get(floor.floorNumber) || 0;
    const hasTrouble = troubleCount > 0 || (!isVacant && hasEmergencyRepair);
    const hasNegotiation = Boolean(floor.tenant && floor.tenant.pendingRentNegotiation);
    const hasRecentEvent = Boolean(floor.recentEvent);
    const waitingApplicants = isVacant
      ? state.applicants.filter((a) => a.desiredTier === floor.tier)
      : [];
    const hasWaitingApplicants = waitingApplicants.length > 0;

    // 3Dリングの表示制御
    vis.alertRing.visible = hasTrouble;
    vis.eventRing.visible =
      !hasTrouble && (hasNegotiation || hasRecentEvent || hasWaitingApplicants);

    if (isVacant) {
      // 空室：消灯して落ち着いたダークガラスにする
      vis.glassMat.color.setHex(0x0f172a);
      vis.glassMat.emissive.setHex(0x000000);
      vis.glassMat.emissiveIntensity = 0;
      vis.glassMat.opacity = 0.78;
      vis.interiorMat.color.setHex(0x0b1120);
      vis.interiorMat.emissive.setHex(0x000000);
      vis.interiorMat.emissiveIntensity = 0;
    } else {
      // 入居中：階層または本性に応じて室内が美しく発光！
      const tenant = floor.tenant;
      let litColor = 0xfde68a; // 低層：ウォームアンバー
      let glassTint = 0x34d399;

      if (tenant.isNatureRevealed && tenant.trueNature === 'bad') {
        litColor = 0xff1744; // 悪質住民：ダーククリムゾン
        glassTint = 0xf43f5e;
      } else if (floor.tier === 'high') {
        litColor = 0xf3e8ff; // 高層：シャンパンパープル
        glassTint = 0xc084fc;
      } else if (floor.tier === 'mid') {
        litColor = 0xe0f2fe; // 中層：クールオフィスライト
        glassTint = 0x60a5fa;
      }

      vis.interiorMat.color.setHex(litColor);
      vis.interiorMat.emissive.setHex(litColor);
      vis.interiorMat.emissiveIntensity = 0.85;

      vis.glassMat.color.setHex(glassTint);
      vis.glassMat.emissive.setHex(litColor);
      vis.glassMat.emissiveIntensity = 0.35;
      vis.glassMat.opacity = 0.52;
    }

    // 3. 3Dフロア横の追従HTMLピンの更新（最小限の情報＋バッジ）
    const labelEl = vis.labelEl;
    if (isVacant) {
      const leaveBadge = floor.recentEvent
        ? `<span class="pin-badge badge-event">${floor.recentEvent.label}</span>`
        : '';
      const applicantBadge = hasWaitingApplicants
        ? `<span class="pin-badge badge-applicant">📋待${waitingApplicants.length}</span>`
        : '';
      labelEl.className = `tower3d-floor-label is-vacant ${hasRecentEvent ? 'has-event' : ''} ${
        hasWaitingApplicants ? 'has-applicant' : ''
      }`;
      labelEl.innerHTML = `
        <span class="pin-floor tier-${floor.tier}">${floor.floorNumber}F</span>
        <span class="pin-name">空室</span>
        <span class="pin-rent">${floor.currentRent}万</span>
        ${leaveBadge}
        ${applicantBadge}
      `;
    } else {
      const tenant = floor.tenant;
      const avatar = getCharacterAvatar(tenant, floor.tier);
      const mood = getMoodEmoji(tenant, hasTrouble);
      let badgeHtml = '';
      if (troubleCount > 0) {
        badgeHtml = `<span class="pin-badge badge-trouble">⚡${troubleCount > 1 ? `×${troubleCount}` : '発生'}</span>`;
      } else if (hasEmergencyRepair) {
        badgeHtml = `<span class="pin-badge badge-trouble">🚨緊急</span>`;
      } else if (tenant.pendingRentNegotiation) {
        const isUp = tenant.pendingRentNegotiation.type === 'up';
        badgeHtml = `<span class="pin-badge badge-event">${isUp ? '📈UP' : '📉減額'}</span>`;
      } else if (tenant.isInArrears) {
        badgeHtml = `<span class="pin-badge badge-trouble">💸滞納</span>`;
      }

      labelEl.className = `tower3d-floor-label is-occupied ${hasTrouble ? 'has-trouble' : ''} ${
        hasNegotiation ? 'has-event' : ''
      }`;
      labelEl.innerHTML = `
        <span class="pin-floor tier-${floor.tier}">${floor.floorNumber}F</span>
        <span class="pin-avatar">${avatar}${mood}</span>
        <span class="pin-name">${tenant.name}</span>
        <span class="pin-rent">${tenant.isInArrears ? '0万' : `${floor.currentRent}万`}</span>
        ${badgeHtml}
      `;
    }
  }
}

/**
 * カメラ位置を球面座標・高さから更新する
 */
function updateCameraPosition() {
  if (!camera) return;
  camera.position.x = Math.sin(cameraAngleY) * cameraDistance;
  camera.position.z = Math.cos(cameraAngleY) * cameraDistance;
  camera.position.y = cameraElevation;
  camera.lookAt(cameraTarget);
}

/**
 * マウス・タッチ操作（回転ドラッグ・2本指ピンチイン/ピンチアウト・フロアタップRaycaster）を登録する
 * @param {HTMLCanvasElement} canvas 3Dキャンバス要素
 */
function bindInteractionEvents(canvas) {
  const targetSurface = containerEl || canvas;

  // スマホブラウザのネイティブピンチズーム・スクロール干渉を抑止
  targetSurface.addEventListener(
    'touchmove',
    (e) => {
      if (e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
  targetSurface.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  targetSurface.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });

  targetSurface.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest && e.target.closest('.tower3d-emergency-btn')) {
      return;
    }

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      isDragging = true;
      wasMultiTouch = false;
      maxMoveDistance = 0;
      pointerDownPos = { x: e.clientX, y: e.clientY };
      prevPointerPos = { x: e.clientX, y: e.clientY };
      lastPinchDistance = null;
      lastPinchMidY = null;
    } else if (activePointers.size >= 2) {
      isDragging = true;
      wasMultiTouch = true;
      const pts = Array.from(activePointers.values());
      lastPinchDistance = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      lastPinchMidY = (pts[0].y + pts[1].y) * 0.5;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 2本指でのピンチイン・ピンチアウト（ズーム＆上下視点移動）
      if (activePointers.size >= 2) {
        wasMultiTouch = true;
        const pts = Array.from(activePointers.values());
        const currentDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const currentMidY = (pts[0].y + pts[1].y) * 0.5;

        if (lastPinchDistance !== null && currentDist > 8 && lastPinchDistance > 8) {
          const zoomScale = lastPinchDistance / currentDist;
          cameraDistance = Math.max(13.5, Math.min(36.0, cameraDistance * zoomScale));
        }
        if (lastPinchMidY !== null) {
          const dyMid = currentMidY - lastPinchMidY;
          cameraElevation = Math.max(3.5, Math.min(22.0, cameraElevation + dyMid * 0.035));
        }

        lastPinchDistance = currentDist;
        lastPinchMidY = currentMidY;
        updateCameraPosition();
        return;
      }

      // 1本指またはマウスでの回転ドラッグ（マルチタッチ直後の残り1本指による座標ジャンプを防止）
      if (isDragging && activePointers.size === 1 && !wasMultiTouch) {
        const dx = e.clientX - prevPointerPos.x;
        const dy = e.clientY - prevPointerPos.y;
        prevPointerPos = { x: e.clientX, y: e.clientY };

        const totalDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (totalDist > maxMoveDistance) {
          maxMoveDistance = totalDist;
        }

        baseCameraAngleY -= dx * 0.008;
        cameraElevation = Math.max(3.5, Math.min(22.0, cameraElevation + dy * 0.04));
        updateCameraPosition();
        return;
      }
      return;
    }

    // 非ドラッグ時のホバーによるフロアハイライト判定（PCマウス用）
    if (isDragging || !containerEl || !renderer) return;
    const rect = canvas.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      setHoveredFloor(null);
      return;
    }

    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(floorMeshes, false);

    if (hits.length > 0) {
      const fNum = hits[0].object.userData.floorNumber;
      setHoveredFloor(fNum);
      canvas.style.cursor = 'pointer';
    } else {
      setHoveredFloor(null);
      canvas.style.cursor = 'grab';
    }
  });

  const handlePointerEnd = (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);

    if (activePointers.size < 2) {
      lastPinchDistance = null;
      lastPinchMidY = null;
    }

    // 2本指から1本指になった瞬間は残り指の現在座標に同期して視点ジャンプを防ぐ
    if (activePointers.size === 1) {
      const remaining = activePointers.values().next().value;
      if (remaining) {
        prevPointerPos = { x: remaining.x, y: remaining.y };
      }
      return;
    }

    if (activePointers.size === 0) {
      const wasPinchOrDrag = wasMultiTouch || maxMoveDistance >= 8;
      if (wasPinchOrDrag) {
        lastGestureEndTime = performance.now();
      } else if (
        renderer &&
        !(e.target && e.target.closest && e.target.closest('.tower3d-floor-label'))
      ) {
        // 1本指で移動距離が小さい場合はフロアタップとみなしてRaycasterを実行
        const rect = canvas.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointerNDC, camera);
          const hits = raycaster.intersectObjects(floorMeshes, false);
          if (hits.length > 0) {
            const floorNum = hits[0].object.userData.floorNumber;
            const state = getState();
            const targetFloor = state.floors.find((f) => f.floorNumber === floorNum);
            if (targetFloor && onStateChangedCallback) {
              showFloorDetailModal(targetFloor, onStateChangedCallback);
            }
          }
        }
      }

      isDragging = false;
      wasMultiTouch = false;
    }
  };

  window.addEventListener('pointerup', handlePointerEnd);
  window.addEventListener('pointercancel', handlePointerEnd);

  // PCホイール・トラックパッドによるズーム操作
  targetSurface.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cameraDistance = Math.max(13.5, Math.min(36.0, cameraDistance + e.deltaY * 0.012));
      updateCameraPosition();
    },
    { passive: false }
  );
}

/**
 * ホバー中のフロアのスケールを少し拡大してフィードバックする
 * @param {number | null} floorNumber ホバー中の階数
 */
function setHoveredFloor(floorNumber) {
  if (hoveredFloorNumber === floorNumber) return;

  if (hoveredFloorNumber && floorVisuals[hoveredFloorNumber]) {
    floorVisuals[hoveredFloorNumber].group.scale.set(1, 1, 1);
    floorVisuals[hoveredFloorNumber].labelEl.classList.remove('is-hovered');
  }

  hoveredFloorNumber = floorNumber;

  if (hoveredFloorNumber && floorVisuals[hoveredFloorNumber]) {
    floorVisuals[hoveredFloorNumber].group.scale.set(1.045, 1.02, 1.045);
    floorVisuals[hoveredFloorNumber].labelEl.classList.add('is-hovered');
  }
}

/**
 * リサイズ時にカメラとレンダラーのサイズを更新する
 */
export function handleResize() {
  if (!containerEl || !renderer || !camera) return;
  const width = containerEl.clientWidth;
  const height = containerEl.clientHeight;
  if (width <= 0 || height <= 0) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

/**
 * 3Dフロアのワールド座標を2Dスクリーン座標へ投影し、HTMLラベルの位置を同期する
 */
function updateFloatingLabelsPosition() {
  if (!containerEl || !camera) return;
  const width = containerEl.clientWidth;
  const height = containerEl.clientHeight;
  if (width <= 0 || height <= 0) return;

  const tempVec = new THREE.Vector3();

  for (const floorNumStr of Object.keys(floorVisuals)) {
    const vis = floorVisuals[floorNumStr];
    // ビル正面左寄りの座標をスクリーンへ投影
    tempVec.set(0, vis.yPos, 3.0);
    tempVec.project(camera);

    const screenX = (tempVec.x * 0.5 + 0.5) * width;
    const screenY = (-(tempVec.y * 0.5) + 0.5) * height;

    vis.labelEl.style.transform = `translate(-50%, -50%) translate(${Math.round(screenX)}px, ${Math.round(screenY)}px)`;
  }
}

/**
 * 毎フレームのアニメーションループ
 * @param {number} timestamp ミリ秒タイムスタンプ
 */
function animateLoop(timestamp) {
  requestAnimationFrame(animateLoop);
  if (!renderer || !scene || !camera) return;

  const t = timestamp * 0.001;

  // 1. 屋上レーダーの回転とビーコン点滅
  if (roofRadarMesh) {
    roofRadarMesh.rotation.y = t * 1.6;
  }
  if (roofBeaconLight) {
    roofBeaconLight.intensity = Math.sin(t * 5) > 0 ? 1.8 : 0.2;
  }

  // 2. トラブル・イベントリングの回転アニメーション
  for (const floorNumStr of Object.keys(floorVisuals)) {
    const vis = floorVisuals[floorNumStr];
    if (vis.alertRing.visible) {
      const pulse = 1 + Math.sin(t * 7) * 0.06;
      vis.alertRing.scale.set(pulse, pulse, 1);
    }
    if (vis.eventRing.visible) {
      const pulse = 1 + Math.sin(t * 4) * 0.04;
      vis.eventRing.scale.set(pulse, pulse, 1);
    }
  }

  // 3. 季節パーティクルの落下アニメーション
  if (particleSystem) {
    const posAttr = particleSystem.geometry.attributes.position;
    const arr = posAttr.array;
    for (let i = 0; i < particleVelocities.length; i++) {
      const vel = particleVelocities[i];
      arr[i * 3] += vel.vx + Math.sin(t + i) * 0.005;
      arr[i * 3 + 1] += vel.vy;
      arr[i * 3 + 2] += vel.vz;

      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 21;
        arr[i * 3] = (Math.random() - 0.5) * 24;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 20;
      }
    }
    posAttr.needsUpdate = true;
  }

  // 4. プレイヤーが回転させた基準角度（baseCameraAngleY）を維持しつつ、ごく緩やかに呼吸運動させる
  cameraAngleY = baseCameraAngleY + Math.sin(t * 0.35) * 0.08;
  updateCameraPosition();

  updateFloatingLabelsPosition();
  renderer.render(scene, camera);
}
