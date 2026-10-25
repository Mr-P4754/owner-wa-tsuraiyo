/**
 * repairLogic.js
 * 5年（20ターン）ごとの定期大規模修繕・任意の臨時大規模改修・住民協力金算出・支払い処理ロジック
 */

import {
  GAME_CONFIG,
  getScheduledRepairBaseCost,
  getCurrentPeriodRepairBaseCost,
  getBaseTroubleProbability,
} from '../config.js';
import {
  getState,
  getOccupiedFloors,
  getOccupancyRate,
  getAverageTrust,
  updateReputation,
  updateTenantTrust,
  addLog,
  saveGame,
} from '../state.js';

/**
 * 次回の定期大規模修繕に関する情報（発生ターン、残りターン数、基本修繕費用）を取得する
 * @param {number} currentTurn 現在のターン数
 * @returns {{ nextRepairTurn: number, turnsRemaining: number, baseCost: number, repairNumber: number }}
 */
export function getNextRepairScheduleInfo(currentTurn = getState().turn) {
  const state = getState();
  const currentElapsed = state.turnsSinceLastRepair ?? 0;
  const repairTurns = Object.keys(GAME_CONFIG.REPAIR_SCHEDULE)
    .map(Number)
    .sort((a, b) => a - b);

  for (let i = 0; i < repairTurns.length; i++) {
    const targetTurn = repairTurns[i];
    if (currentTurn <= targetTurn) {
      const turnsRemaining = targetTurn - currentTurn;
      const estimatedElapsedAtRepair = currentElapsed + turnsRemaining;
      return {
        nextRepairTurn: targetTurn,
        turnsRemaining,
        baseCost: getScheduledRepairBaseCost(
          targetTurn,
          state.totalFloors,
          estimatedElapsedAtRepair
        ),
        repairNumber: i + 1,
      };
    }
  }

  // 60ターン以降の場合
  const lastTurn = repairTurns[repairTurns.length - 1];
  return {
    nextRepairTurn: lastTurn,
    turnsRemaining: 0,
    baseCost: getScheduledRepairBaseCost(lastTurn, state.totalFloors, currentElapsed),
    repairNumber: repairTurns.length,
  };
}

/**
 * 指定した基本修繕費用に対する「住民協力金」と「オーナー負担額」および支払い内訳を試算する（要件定義 3.4）
 * 住民協力金 ＝ 基本修繕費用 × (入居率 / 100) × (全体平均信頼度 / 100) × 0.6
 * @param {number} baseCost 基本修繕費用（万円）
 * @returns {{
 *   baseCost: number,
 *   occupancyRate: number,
 *   averageTrust: number,
 *   effectiveTrustForRepair: number,
 *   subsidyAmount: number,
 *   ownerBurden: number,
 *   paidFromReserve: number,
 *   paidFromFunds: number,
 *   shortfall: number,
 *   canAfford: boolean
 * }}
 */
export function calculateRepairBreakdown(baseCost) {
  const state = getState();
  const occupancyRate = getOccupancyRate();
  const averageTrust = getAverageTrust(false);
  // 高齢世帯の修繕協力ボーナスを加味した実質信頼度
  const effectiveTrustForRepair = getAverageTrust(true);

  const rawSubsidy =
    baseCost *
    (occupancyRate / 100) *
    (effectiveTrustForRepair / 100) *
    GAME_CONFIG.REPAIR_SUBSIDY_FACTOR;

  const subsidyAmount = Math.round(rawSubsidy);
  const ownerBurden = Math.max(0, baseCost - subsidyAmount);

  const paidFromReserve = Math.min(state.repairReserve, ownerBurden);
  const remainingAfterReserve = ownerBurden - paidFromReserve;
  const paidFromFunds = Math.min(Math.max(0, state.funds), remainingAfterReserve);
  const shortfall = Math.max(0, remainingAfterReserve - Math.max(0, state.funds));
  const canAfford = state.repairReserve + state.funds >= ownerBurden;

  return {
    baseCost,
    occupancyRate,
    averageTrust,
    effectiveTrustForRepair,
    subsidyAmount,
    ownerBurden,
    paidFromReserve,
    paidFromFunds,
    shortfall,
    canAfford,
  };
}

/**
 * 臨時大規模改修の試算情報と現在のビル劣化・トラブル発生率情報を取得する
 * @returns {{
 *   turnsSinceLastRepair: number,
 *   currentProbPercent: number,
 *   afterProbPercent: number,
 *   breakdown: object,
 *   alreadyRepairedThisTurn: boolean
 * }}
 */
export function getExtraRepairInfo() {
  const state = getState();
  const turnsSinceLastRepair = state.turnsSinceLastRepair ?? 0;
  const baseCost = getCurrentPeriodRepairBaseCost(state.turn, state.totalFloors || 10);

  const breakdown = calculateRepairBreakdown(baseCost);
  const currentProbPercent = Number(
    (getBaseTroubleProbability(turnsSinceLastRepair) * 100).toFixed(1)
  );
  const afterProbPercent = Number(
    (GAME_CONFIG.BASE_TROUBLE_PROB_AFTER_REPAIR * 100).toFixed(1)
  );

  return {
    turnsSinceLastRepair,
    currentProbPercent,
    afterProbPercent,
    breakdown,
    alreadyRepairedThisTurn: turnsSinceLastRepair === 0,
  };
}

/**
 * プレイヤーの任意タイミングで「臨時大規模改修」を実行する
 * ・修繕積立金→手元資金の順でオーナー負担額を支払う
 * ・経過ターン（turnsSinceLastRepair）を0にリセットし、トラブル発生率を最低水準（6%）へ引き下げる
 * ・全入居者の信頼度+5、ビルの評判+3のボーナスを付与し、次回定期修繕の基本費用も軽減する
 * @returns {{
 *   success: boolean,
 *   message: string,
 *   info: object
 * }}
 */
export function executeExtraRepair() {
  const state = getState();
  const info = getExtraRepairInfo();

  if (info.alreadyRepairedThisTurn) {
    return {
      success: false,
      message: '大規模改修を実施したばかりのため、現在ビルは最新状態です。',
      info,
    };
  }

  const { breakdown } = info;
  if (!breakdown.canAfford) {
    return {
      success: false,
      message: `資金が不足しています（オーナー負担額 ${breakdown.ownerBurden.toLocaleString()}万円 に対し ${breakdown.shortfall.toLocaleString()}万円 不足）。`,
      info,
    };
  }

  state.repairReserve -= breakdown.paidFromReserve;
  state.funds -= breakdown.paidFromFunds;
  state.turnsSinceLastRepair = 0;
  state.extraRepairCount = (state.extraRepairCount || 0) + 1;

  // 全入居者の信頼度+5・評判+3
  const occupied = getOccupiedFloors();
  for (const floor of occupied) {
    updateTenantTrust(floor.floorNumber, 5);
  }
  updateReputation(3);

  const msg = `【臨時大規模改修完了】負担額 ${breakdown.ownerBurden.toLocaleString()}万（積立-${breakdown.paidFromReserve.toLocaleString()}万 / 資金-${breakdown.paidFromFunds.toLocaleString()}万 / 協力金${breakdown.subsidyAmount.toLocaleString()}万）を支払い、トラブル発生率が ${info.currentProbPercent}% → ${info.afterProbPercent}% に大幅低下！（全室信頼+5・評判+3）`;

  addLog(msg, 'good', '臨時改修');
  saveGame();

  return {
    success: true,
    message: msg,
    info: getExtraRepairInfo(),
  };
}

/**
 * ターン終了時（20・40・60ターン目）に定期大規模修繕を実行する
 * @returns {{
 *   triggered: boolean,
 *   success: boolean,
 *   repairYear: number,
 *   breakdown: object | null,
 *   remainingReserve: number,
 *   remainingFunds: number,
 *   message: string
 * }}
 */
export function executeScheduledRepairIfDue() {
  const state = getState();
  const baseCost = getScheduledRepairBaseCost(
    state.turn,
    state.totalFloors,
    state.turnsSinceLastRepair ?? 20
  );

  if (!baseCost || baseCost <= 0) {
    return {
      triggered: false,
      success: true,
      repairYear: 0,
      breakdown: null,
      remainingReserve: state.repairReserve,
      remainingFunds: state.funds,
      message: '',
    };
  }

  const repairYear = Math.floor(state.turn / GAME_CONFIG.TURNS_PER_YEAR);
  const breakdown = calculateRepairBreakdown(baseCost);

  // 修繕積立金と手元資金を合算しても支払えない場合は「修繕破綻」でゲームオーバー
  if (!breakdown.canAfford) {
    state.repairReserve = 0;
    state.funds -= breakdown.ownerBurden - breakdown.paidFromReserve;
    state.isGameOver = true;
    state.gameOverReason = `【修繕破綻】${repairYear}年目（${state.turn}ターン目）の大規模修繕において、オーナー負担額 ${breakdown.ownerBurden.toLocaleString()}万円 に対し資金が ${breakdown.shortfall.toLocaleString()}万円 不足し、ビルの維持継続が不可能となりました。`;

    addLog(state.gameOverReason, 'bad', '大規模修繕失敗');

    return {
      triggered: true,
      success: false,
      repairYear,
      breakdown,
      remainingReserve: state.repairReserve,
      remainingFunds: state.funds,
      message: state.gameOverReason,
    };
  }

  // 支払い実行：まず修繕積立金口座から差し引き、不足分は手元資金から支払う
  state.repairReserve -= breakdown.paidFromReserve;
  state.funds -= breakdown.paidFromFunds;
  // 大規模修繕完了によりビルの経年劣化（トラブル発生率上昇カウント）をリセット
  state.turnsSinceLastRepair = 0;

  const successMsg = `【第${repairYear / 5}回 大規模修繕完了（${repairYear}年目）】基本修繕費 ${breakdown.baseCost.toLocaleString()}万円のうち、住民協力金 ${breakdown.subsidyAmount.toLocaleString()}万円（入居率${breakdown.occupancyRate}%・信頼度${breakdown.effectiveTrustForRepair}）が集まり、オーナー負担額 ${breakdown.ownerBurden.toLocaleString()}万円（積立金充当: ${breakdown.paidFromReserve.toLocaleString()}万円 / 手元資金支出: ${breakdown.paidFromFunds.toLocaleString()}万円）を完済！設備が刷新されトラブル発生率が大幅低下しました！`;

  addLog(successMsg, 'good', '大規模修繕');

  return {
    triggered: true,
    success: true,
    repairYear,
    breakdown,
    remainingReserve: state.repairReserve,
    remainingFunds: state.funds,
    message: successMsg,
  };
}
