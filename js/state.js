/**
 * state.js
 * ゲーム状態管理（資金、ターン、フロア配列、階層別維持費、ビル断面イベントバッジ、セーブ/ロード）
 */

import {
  GAME_CONFIG,
  getFloorTierConfig,
  getMaintenanceCostBreakdown,
} from './config.js';

let gameState = null;

/**
 * 数値を指定範囲内に収めるユーティリティ関数
 * @param {number} value 対象数値
 * @param {number} min 最小値
 * @param {number} max 最大値
 * @returns {number} 範囲内の数値
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 初期状態のフロア配列（1階〜TOTAL_FLOORS階）を生成する
 * @param {number} totalFloors 総階数
 * @returns {Array<object>} フロアオブジェクトの配列
 */
function createInitialFloors(totalFloors = GAME_CONFIG.TOTAL_FLOORS) {
  const floors = [];
  for (let floorNumber = 1; floorNumber <= totalFloors; floorNumber++) {
    const tierConfig = getFloorTierConfig(floorNumber, totalFloors);
    floors.push({
      floorNumber,
      tier: tierConfig.id,
      tierName: tierConfig.name,
      targetName: tierConfig.targetName,
      standardRent: tierConfig.standardRent,
      currentRent: tierConfig.standardRent,
      maintenanceCost: tierConfig.maintenanceCostPerFloor,
      vacantTurns: 0,
      tenant: null,
      recentEvent: null,
    });
  }
  return floors;
}

/**
 * 新規ゲーム状態を初期化する
 * @returns {object} 初期化されたゲーム状態オブジェクト
 */
export function initNewState() {
  const totalFloors = GAME_CONFIG.TOTAL_FLOORS;
  gameState = {
    totalFloors,
    turn: 1,
    year: 1,
    seasonIndex: 0,
    turnsSinceLastRepair: 0,
    extraRepairCount: 0,
    funds: GAME_CONFIG.INITIAL_FUNDS,
    repairReserve: GAME_CONFIG.INITIAL_REPAIR_RESERVE,
    autoReserveAmount: 0,
    nextRentPolicy: 'none',
    reputation: GAME_CONFIG.INITIAL_REPUTATION,
    isGameOver: false,
    isGameClear: false,
    gameOverReason: '',
    activeTab: 'building',
    hasUnreadLog: false,
    floors: createInitialFloors(totalFloors),
    applicants: [],
    troubles: [],
    logs: [],
    currentTurnExpenses: {
      investigation: 0,
      trouble: 0,
      eviction: 0,
      manualReserve: 0,
    },
    lastTurnSummary: null,
  };

  addLog('ビル運営開始！入居審査から住民を迎えましょう。', 'info', '開始');
  return gameState;
}

/**
 * 現在のゲーム状態を取得する
 * @returns {object} ゲーム状態オブジェクト
 */
export function getState() {
  if (!gameState) {
    return initNewState();
  }
  return gameState;
}

/**
 * 現在のターン数から年数と季節文字列を取得する
 * @param {number} turn ターン数
 * @returns {{ year: number, seasonIndex: number, seasonName: string, formatted: string }}
 */
export function getTimeInfo(turn = getState().turn) {
  const year = Math.floor((turn - 1) / GAME_CONFIG.TURNS_PER_YEAR) + 1;
  const seasonIndex = (turn - 1) % GAME_CONFIG.TURNS_PER_YEAR;
  const seasonName = GAME_CONFIG.SEASONS[seasonIndex];
  return {
    year,
    seasonIndex,
    seasonName,
    formatted: `${year}年目・${seasonName}`,
  };
}

/**
 * 運営ログを追加する
 * @param {string} message ログ本文
 * @param {'info' | 'good' | 'warn' | 'bad'} type ログ種別
 * @param {string} category カテゴリ名
 */
export function addLog(message, type = 'info', category = '通知') {
  const state = getState();
  const timeInfo = getTimeInfo(state.turn);
  state.logs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    turn: state.turn,
    timeLabel: `${timeInfo.formatted}(${state.turn}T)`,
    category,
    message,
    type,
  });

  if (state.logs.length > 150) {
    state.logs.length = 150;
  }

  if (state.activeTab !== 'log' && (type === 'warn' || type === 'bad')) {
    state.hasUnreadLog = true;
  }
}

/**
 * 特定フロアのオブジェクトを取得する
 * @param {number} floorNumber 階数
 * @returns {object | undefined} フロアオブジェクト
 */
export function getFloor(floorNumber) {
  const state = getState();
  return state.floors.find((f) => f.floorNumber === Number(floorNumber));
}

/**
 * 入居中のフロア一覧を取得する
 * @returns {Array<object>} 入居中フロアの配列
 */
export function getOccupiedFloors() {
  const state = getState();
  return state.floors.filter((f) => f.tenant !== null);
}

/**
 * 空室のフロア一覧を取得する
 * @returns {Array<object>} 空室フロアの配列
 */
export function getVacantFloors() {
  const state = getState();
  return state.floors.filter((f) => f.tenant === null);
}

/**
 * ビル断面で発生している未確認イベント（退去情報・家賃上昇・減額交渉）の件数を取得する
 * @returns {number} 未確認イベント件数
 */
export function getBuildingEventCount() {
  const state = getState();
  let count = 0;
  for (const floor of state.floors) {
    const hasNegotiation = Boolean(floor.tenant && floor.tenant.pendingRentNegotiation);
    const hasRecentEvent = Boolean(floor.recentEvent);
    if (hasNegotiation || hasRecentEvent) {
      count += 1;
    }
  }
  return count;
}

/**
 * 全フロアの退去通知イベントをクリアする
 */
export function clearFloorRecentEvents() {
  const state = getState();
  for (const floor of state.floors) {
    floor.recentEvent = null;
  }
}

/**
 * 現在の入居率（0〜100%）を算出する
 * @returns {number} 入居率（整数パーセント）
 */
export function getOccupancyRate() {
  const state = getState();
  if (state.floors.length === 0) return 0;
  const occupiedCount = getOccupiedFloors().length;
  return Math.round((occupiedCount / state.floors.length) * 100);
}

/**
 * 全入居世帯の平均信頼度（0〜100）を算出する
 * @param {boolean} includeAgingBonus 大規模修繕用に高齢世帯の協力ボーナスを含めるか
 * @returns {number} 全体平均信頼度
 */
export function getAverageTrust(includeAgingBonus = false) {
  const occupied = getOccupiedFloors();
  if (occupied.length === 0) return 0;

  const totalTrust = occupied.reduce((sum, floor) => {
    let trust = floor.tenant.trust;
    if (includeAgingBonus && floor.tenant.isAged) {
      trust = clamp(trust + GAME_CONFIG.AGING_REPAIR_TRUST_BONUS, 0, 100);
    }
    return sum + trust;
  }, 0);

  return Math.round(totalTrust / occupied.length);
}

/**
 * 今ターン終了時の見込み収支と階層別維持費・税金内訳を計算する
 * 税金 ＝ max(0, 収入 － (維持費 ＋ 積立費)) × 税率
 * @returns {{
 *   grossRent: number,
 *   arrearsLoss: number,
 *   effectiveRent: number,
 *   maintenanceBreakdown: { low: number, mid: number, high: number, total: number },
 *   maintenanceCost: number,
 *   autoReserve: number,
 *   manualReserve: number,
 *   totalReserve: number,
 *   taxableIncome: number,
 *   taxAmount: number,
 *   netCashflow: number
 * }}
 */
export function calculateExpectedTurnCashflow() {
  const state = getState();
  let grossRent = 0;
  let arrearsLoss = 0;

  for (const floor of state.floors) {
    if (floor.tenant) {
      grossRent += floor.currentRent;
      if (floor.tenant.isInArrears) {
        arrearsLoss += floor.currentRent;
      }
    }
  }

  const effectiveRent = grossRent - arrearsLoss;
  const maintenanceBreakdown = getMaintenanceCostBreakdown(state.totalFloors);
  const maintenanceCost = maintenanceBreakdown.total;
  const autoReserve = state.autoReserveAmount || 0;
  const manualReserve = state.currentTurnExpenses?.manualReserve || 0;
  const totalReserve = autoReserve + manualReserve;
  const taxableIncome = Math.max(0, effectiveRent - (maintenanceCost + totalReserve));
  const taxAmount = Math.round(taxableIncome * GAME_CONFIG.TAX_RATE);
  const netCashflow = effectiveRent - maintenanceCost - autoReserve - taxAmount;

  return {
    grossRent,
    arrearsLoss,
    effectiveRent,
    maintenanceBreakdown,
    maintenanceCost,
    autoReserve,
    manualReserve,
    totalReserve,
    taxableIncome,
    taxAmount,
    netCashflow,
  };
}

/**
 * ビルの評判を増減させる（0〜100にクランプ）
 * @param {number} delta 変化量
 */
export function updateReputation(delta) {
  const state = getState();
  state.reputation = clamp(state.reputation + delta, 0, 100);
}

/**
 * 特定フロアの入居者の信頼度を増減させる（0〜100にクランプ）
 * @param {number} floorNumber 階数
 * @param {number} delta 変化量
 * @returns {number} 実際に適用された変化量
 */
export function updateTenantTrust(floorNumber, delta) {
  const floor = getFloor(floorNumber);
  if (!floor || !floor.tenant) return 0;

  let actualDelta = delta;
  if (delta < 0 && floor.tenant.isAged) {
    actualDelta = Math.ceil(delta / 2);
  }

  const prevTrust = floor.tenant.trust;
  floor.tenant.trust = clamp(prevTrust + actualDelta, 0, 100);
  return floor.tenant.trust - prevTrust;
}

/**
 * 空室フロアの募集家賃を手動変更する
 * @param {number} floorNumber 階数
 * @param {number} newRent 新しい家賃（万円）
 * @returns {boolean} 変更成功したかどうか
 */
export function setFloorRent(floorNumber, newRent) {
  const floor = getFloor(floorNumber);
  if (!floor || floor.tenant !== null) return false;

  const minRent = Math.round(floor.standardRent * GAME_CONFIG.MIN_RENT_RATIO);
  const maxRent = Math.round(floor.standardRent * GAME_CONFIG.MAX_RENT_RATIO);
  floor.currentRent = clamp(Math.round(newRent), minRent, maxRent);
  return true;
}

/**
 * 手元資金から修繕積立金口座へ任意の金額を振り替える
 * @param {number} amount 振替金額（万円）
 * @returns {{ success: boolean, message: string }}
 */
export function transferToRepairReserve(amount) {
  const state = getState();
  const transferAmount = Math.floor(Number(amount));

  if (isNaN(transferAmount) || transferAmount <= 0) {
    return { success: false, message: '1万円以上を入力してください。' };
  }

  if (transferAmount > state.funds) {
    return { success: false, message: '手元資金が不足しています。' };
  }

  state.funds -= transferAmount;
  state.repairReserve += transferAmount;
  state.currentTurnExpenses.manualReserve += transferAmount;

  addLog(
    `修繕積立へ ${transferAmount.toLocaleString()}万 振替（積立残: ${state.repairReserve.toLocaleString()}万）`,
    'info',
    '積立'
  );

  saveGame();
  return {
    success: true,
    message: `${transferAmount.toLocaleString()}万円を積立口座へ振り替えました。`,
  };
}

/**
 * 毎ターンの自動積立額を設定する
 * @param {number} amount 自動積立額（万円）
 */
export function setAutoReserveAmount(amount) {
  const state = getState();
  const val = Math.max(0, Math.floor(Number(amount) || 0));
  state.autoReserveAmount = val;
  saveGame();
}

/**
 * 指定した次期家賃方針（'up' | 'down' | 'none'）に基づく1フロアの改定後家賃を算出する
 * @param {object} floor フロアオブジェクト
 * @param {'up' | 'down' | 'none'} policy 次期家賃方針
 * @returns {number} 改定後家賃（万円）
 */
export function calcAdjustedFloorRent(floor, policy) {
  const minRent = Math.round(floor.standardRent * GAME_CONFIG.MIN_RENT_RATIO);
  const maxRent = Math.round(floor.standardRent * GAME_CONFIG.MAX_RENT_RATIO);
  if (policy === 'up') {
    const rawUp = Math.round(floor.currentRent * (1 + GAME_CONFIG.NEXT_RENT_CHANGE_RATE));
    const steppedUp = rawUp === floor.currentRent ? floor.currentRent + 1 : rawUp;
    return clamp(steppedUp, minRent, maxRent);
  }
  if (policy === 'down') {
    const rawDown = Math.round(floor.currentRent * (1 - GAME_CONFIG.NEXT_RENT_CHANGE_RATE));
    const steppedDown = rawDown === floor.currentRent ? floor.currentRent - 1 : rawDown;
    return clamp(steppedDown, minRent, maxRent);
  }
  return floor.currentRent;
}

/**
 * 次期家賃の一括改定方針（'up':5%増額 / 'down':5%減額 / 'none':据置）を設定またはトグル解除する
 * @param {'up' | 'down' | 'none'} policy 選択された方針
 * @returns {'up' | 'down' | 'none'} 更新後の方針
 */
export function setNextRentPolicy(policy) {
  const state = getState();
  if (state.nextRentPolicy === policy) {
    state.nextRentPolicy = 'none';
  } else if (policy === 'up' || policy === 'down') {
    state.nextRentPolicy = policy;
  } else {
    state.nextRentPolicy = 'none';
  }
  saveGame();
  return state.nextRentPolicy;
}

/**
 * 次期家賃改定（5%増額 / 5%減額）の試算情報と評判・信頼トレードオフ値を取得する
 * @returns {{
 *   policy: 'up' | 'down' | 'none',
 *   occupiedCount: number,
 *   currentRentTotal: number,
 *   nextRentTotal: number,
 *   rentDelta: number,
 *   upRentTotal: number,
 *   upDelta: number,
 *   downRentTotal: number,
 *   downDelta: number,
 *   trustDelta: number,
 *   reputationDelta: number
 * }}
 */
export function getNextRentPolicyPreview() {
  const state = getState();
  const policy = state.nextRentPolicy || 'none';
  const occupied = getOccupiedFloors();

  let currentRentTotal = 0;
  let upRentTotal = 0;
  let downRentTotal = 0;

  for (const floor of occupied) {
    currentRentTotal += floor.currentRent;
    upRentTotal += calcAdjustedFloorRent(floor, 'up');
    downRentTotal += calcAdjustedFloorRent(floor, 'down');
  }

  const upDelta = upRentTotal - currentRentTotal;
  const downDelta = downRentTotal - currentRentTotal;
  const nextRentTotal =
    policy === 'up' ? upRentTotal : policy === 'down' ? downRentTotal : currentRentTotal;
  const rentDelta = nextRentTotal - currentRentTotal;

  const trustDelta =
    policy === 'up'
      ? GAME_CONFIG.NEXT_RENT_UP_TRUST_DELTA
      : policy === 'down'
      ? GAME_CONFIG.NEXT_RENT_DOWN_TRUST_DELTA
      : 0;
  const reputationDelta =
    policy === 'up'
      ? GAME_CONFIG.NEXT_RENT_UP_REPUTATION_DELTA
      : policy === 'down'
      ? GAME_CONFIG.NEXT_RENT_DOWN_REPUTATION_DELTA
      : 0;

  return {
    policy,
    occupiedCount: occupied.length,
    currentRentTotal,
    nextRentTotal,
    rentDelta,
    upRentTotal,
    upDelta,
    downRentTotal,
    downDelta,
    trustDelta,
    reputationDelta,
  };
}

/**
 * ゲーム状態をローカルストレージに保存する
 */
export function saveGame() {
  try {
    const state = getState();
    localStorage.setItem(GAME_CONFIG.STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('セーブ失敗:', err);
  }
}

/**
 * ローカルストレージからゲーム状態を復元する
 * @returns {boolean} ロードに成功したかどうか
 */
export function loadGame() {
  try {
    const raw = localStorage.getItem(GAME_CONFIG.STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.turn !== 'number' || !Array.isArray(parsed.floors)) {
      return false;
    }
    // 旧セーブデータ互換：各フロアにmaintenanceCostを補完、改修経過ターンを補完
    if (typeof parsed.extraRepairCount !== 'number') {
      parsed.extraRepairCount = 0;
    }
    if (typeof parsed.nextRentPolicy !== 'string') {
      parsed.nextRentPolicy = 'none';
    }
    if (typeof parsed.turnsSinceLastRepair !== 'number') {
      parsed.turnsSinceLastRepair = Math.max(0, (parsed.turn - 1) % 20);
    } else if (
      parsed.extraRepairCount === 0 &&
      parsed.turn <= 20 &&
      parsed.turnsSinceLastRepair === parsed.turn + 4
    ) {
      // 旧初期値(5)のまま保存されていた1〜20Tのセーブデータを新築基準(0開始)へ自動補正
      parsed.turnsSinceLastRepair = parsed.turn - 1;
    }
    for (const floor of parsed.floors) {
      if (typeof floor.maintenanceCost !== 'number') {
        const tierCfg = getFloorTierConfig(floor.floorNumber, parsed.totalFloors || 10);
        floor.maintenanceCost = tierCfg.maintenanceCostPerFloor;
      }
    }
    gameState = parsed;
    return true;
  } catch (err) {
    console.warn('ロード失敗:', err);
    return false;
  }
}

/**
 * ローカルストレージのセーブデータを削除する
 */
export function clearSaveData() {
  try {
    localStorage.removeItem(GAME_CONFIG.STORAGE_KEY);
  } catch (err) {
    console.warn('セーブ削除失敗:', err);
  }
}
