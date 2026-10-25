/**
 * turnManager.js
 * ターン進行・収支計算・退去処理（ビル断面バッジ連動）・空室家賃自動下落・クリア/ゲームオーバー判定
 */

import { GAME_CONFIG, getBaseMaintenanceCost } from '../config.js';
import {
  getState,
  getTimeInfo,
  addLog,
  updateReputation,
  updateTenantTrust,
  calcAdjustedFloorRent,
  clearFloorRecentEvents,
  saveGame,
} from '../state.js';
import { generateApplicantsForTurn } from './screening.js';
import {
  generateTroublesForTurn,
  resolveTrouble,
  processTurnStartAgingAndBusiness,
  applyBadTenantReputationPenalty,
} from './troubleLogic.js';
import { executeScheduledRepairIfDue } from './repairLogic.js';

/**
 * 入居者の自主退去（愛想尽かし退去・自然退去）および空室家賃の自動5%下落を処理する
 */
function processTenantsAndVacancyAtTurnEnd() {
  const state = getState();

  for (const floor of state.floors) {
    if (floor.tenant) {
      const tenant = floor.tenant;
      tenant.occupiedTurns += 1;

      // 1. 愛想尽かし退去：信頼度20以下の世帯は50%で自主退去
      if (tenant.trust <= GAME_CONFIG.LOW_TRUST_THRESHOLD) {
        if (Math.random() < GAME_CONFIG.LOW_TRUST_LEAVE_PROBABILITY) {
          const isGoodOrNormal = tenant.trueNature === 'good' || tenant.trueNature === 'normal';
          const leavingName = tenant.name;
          floor.tenant = null;
          floor.vacantTurns = 0;
          floor.currentRent = floor.standardRent;

          if (isGoodOrNormal) {
            updateReputation(-GAME_CONFIG.LOW_TRUST_REPUTATION_PENALTY);
            floor.recentEvent = {
              type: 'leave_bad',
              label: '👋不満退去',
              detail: `「${leavingName}」が不信感から退去（評判-${GAME_CONFIG.LOW_TRUST_REPUTATION_PENALTY}）`,
            };
            addLog(
              `${floor.floorNumber}F「${leavingName}」が不満退去（評判-${GAME_CONFIG.LOW_TRUST_REPUTATION_PENALTY}）`,
              'bad',
              '不満退去'
            );
          } else {
            floor.recentEvent = {
              type: 'leave',
              label: '👋退去',
              detail: `悪質住民「${leavingName}」が自主退去しました`,
            };
            addLog(`${floor.floorNumber}F「${leavingName}」が自主退去`, 'info', '退去');
          }
          continue;
        }
      }

      // 2. ライフステージ退去（自然退去）：入居12ターン以上で10%の確率で円満退去
      if (tenant.occupiedTurns >= GAME_CONFIG.NATURAL_LEAVE_MIN_TURNS) {
        if (Math.random() < GAME_CONFIG.NATURAL_LEAVE_PROBABILITY) {
          const leavingName = tenant.name;
          const yearsStayed = (tenant.occupiedTurns / GAME_CONFIG.TURNS_PER_YEAR).toFixed(1);
          floor.tenant = null;
          floor.vacantTurns = 0;
          floor.currentRent = floor.standardRent;
          floor.recentEvent = {
            type: 'leave',
            label: '👋円満退去',
            detail: `「${leavingName}」（入居${yearsStayed}年）が円満退去しました`,
          };

          addLog(
            `${floor.floorNumber}F「${leavingName}」(${yearsStayed}年)が円満退去`,
            'info',
            '自然退去'
          );
          continue;
        }
      }
    } else {
      // 3. 空室のまま1ターン経過するごとに募集家賃が自動で5%下落（下限50%・次期家賃一括改定予約がない場合のみ）
      floor.vacantTurns += 1;
      if (!state.nextRentPolicy || state.nextRentPolicy === 'none') {
        const minRent = Math.round(floor.standardRent * GAME_CONFIG.MIN_RENT_RATIO);
        if (floor.currentRent > minRent) {
          const prevRent = floor.currentRent;
          const droppedRent = Math.max(
            minRent,
            Math.round(floor.currentRent * (1 - GAME_CONFIG.VACANCY_RENT_DROP_RATE))
          );
          floor.currentRent =
            droppedRent === prevRent ? Math.max(minRent, prevRent - 1) : droppedRent;
        }
      }
    }
  }
}

/**
 * 財務タブで予約された「次期家賃」一括改定（5%増額 / 5%減額）を新ターン開始時に適用する
 * ・5%増額：家賃収入アップ ⇔ 全室信頼度低下・ビル評判低下
 * ・5%減額：家賃収入ダウン ⇔ 全室信頼度上昇・ビル評判上昇
 */
function applyNextTurnRentPolicy() {
  const state = getState();
  const policy = state.nextRentPolicy;
  if (policy !== 'up' && policy !== 'down') return;

  const isUp = policy === 'up';
  const trustDelta = isUp
    ? GAME_CONFIG.NEXT_RENT_UP_TRUST_DELTA
    : GAME_CONFIG.NEXT_RENT_DOWN_TRUST_DELTA;
  const repDelta = isUp
    ? GAME_CONFIG.NEXT_RENT_UP_REPUTATION_DELTA
    : GAME_CONFIG.NEXT_RENT_DOWN_REPUTATION_DELTA;

  let totalRentDelta = 0;
  let occupiedCount = 0;

  for (const floor of state.floors) {
    const prevRent = floor.currentRent;
    const nextRent = calcAdjustedFloorRent(floor, policy);
    floor.currentRent = nextRent;

    if (floor.tenant) {
      occupiedCount += 1;
      floor.tenant.rent = nextRent;
      totalRentDelta += nextRent - prevRent;
      updateTenantTrust(floor.floorNumber, trustDelta);
    }
  }

  updateReputation(repDelta);
  state.nextRentPolicy = 'none';

  const deltaStr = `${totalRentDelta >= 0 ? '+' : ''}${totalRentDelta}万/期`;
  const trustStr =
    occupiedCount > 0 ? `全室信頼${trustDelta >= 0 ? '+' : ''}${trustDelta}・` : '';
  const repStr = `評判${repDelta >= 0 ? '+' : ''}${repDelta}`;

  addLog(
    isUp
      ? `📈 次期家賃5％増額を実施：家賃収入 ${deltaStr}（${trustStr}${repStr}）`
      : `📉 次期家賃5％減額を実施：家賃収入 ${deltaStr}（${trustStr}${repStr}）`,
    isUp ? 'warn' : 'good',
    '家賃改定'
  );
}

/**
 * 現在のターンを終了し、収支計算・大規模修繕・クリア/ゲームオーバー判定・次ターン準備を行う
 * @returns {{
 *   status: 'continue' | 'repair_completed' | 'game_clear' | 'game_over',
 *   repairResult: object | null,
 *   summary: object
 * }}
 */
export function advanceTurn() {
  const state = getState();
  if (state.isGameOver || state.isGameClear) {
    return { status: 'game_over', repairResult: null, summary: state.lastTurnSummary };
  }

  // 前ターンの未確認フロア退去通知をクリアしてから今ターンの処理へ
  clearFloorRecentEvents();

  // 1. 未対応のトラブルが残っている場合はすべて「C. 塩対応」として強制処理
  if (state.troubles.length > 0) {
    const remainingTroubles = [...state.troubles];
    for (const trb of remainingTroubles) {
      resolveTrouble(trb.id, 'C', true);
    }
  }

  // 2. 今ターンの家賃収入と基本維持費の計算
  let grossRentIncome = 0;
  let arrearsLoss = 0;
  for (const floor of state.floors) {
    if (floor.tenant) {
      grossRentIncome += floor.currentRent;
      if (floor.tenant.isInArrears) {
        arrearsLoss += floor.currentRent;
      }
    }
  }
  const effectiveRentIncome = grossRentIncome - arrearsLoss;
  const maintenanceCost = getBaseMaintenanceCost(state.totalFloors);
  const operatingBalance = effectiveRentIncome - maintenanceCost;

  state.funds += operatingBalance;

  // 3. 赤字破産チェック（維持費支払後）
  if (state.funds < 0) {
    state.isGameOver = true;
    state.gameOverReason = `【赤字破産】${getTimeInfo(state.turn).formatted}（${state.turn}T）決算後、手元資金が ${state.funds.toLocaleString()}万円 の赤字となり破産しました。`;
    addLog(state.gameOverReason, 'bad', '破産');

    const bankruptSummary = {
      turn: state.turn,
      effectiveRentIncome,
      arrearsLoss,
      maintenanceCost,
      autoReserveTransferred: 0,
      taxAmount: 0,
      actionExpenses: { ...state.currentTurnExpenses },
      operatingBalance,
      endingFunds: state.funds,
    };
    state.lastTurnSummary = bankruptSummary;
    saveGame();

    return {
      status: 'game_over',
      repairResult: null,
      summary: bankruptSummary,
    };
  }

  // 4. 自動積立の振替処理
  let autoReserveTransferred = 0;
  if (state.autoReserveAmount > 0 && state.funds > 0) {
    autoReserveTransferred = Math.min(state.funds, state.autoReserveAmount);
    state.funds -= autoReserveTransferred;
    state.repairReserve += autoReserveTransferred;
  }

  // 5. 税金の計算と支払処理：税金 ＝ max(0, 収入 － (維持費 ＋ 積立費)) × 税率
  const manualReserveThisTurn = state.currentTurnExpenses?.manualReserve || 0;
  const totalReserveForTax = autoReserveTransferred + manualReserveThisTurn;
  const taxableIncome = Math.max(
    0,
    effectiveRentIncome - (maintenanceCost + totalReserveForTax)
  );
  const taxAmount = Math.round(taxableIncome * GAME_CONFIG.TAX_RATE);
  state.funds -= taxAmount;

  // 税金支払後の赤字破産チェック
  if (state.funds < 0) {
    state.isGameOver = true;
    state.gameOverReason = `【赤字破産】${getTimeInfo(state.turn).formatted}（${state.turn}T）決算・納税（税金 ${taxAmount.toLocaleString()}万円）後、手元資金が ${state.funds.toLocaleString()}万円 の赤字となり破産しました。`;
    addLog(state.gameOverReason, 'bad', '破産');

    const taxBankruptSummary = {
      turn: state.turn,
      effectiveRentIncome,
      arrearsLoss,
      maintenanceCost,
      autoReserveTransferred,
      taxAmount,
      actionExpenses: { ...state.currentTurnExpenses },
      operatingBalance: operatingBalance - taxAmount,
      endingFunds: state.funds,
    };
    state.lastTurnSummary = taxBankruptSummary;
    saveGame();

    return {
      status: 'game_over',
      repairResult: null,
      summary: taxBankruptSummary,
    };
  }

  const netTurnChange = effectiveRentIncome - maintenanceCost - autoReserveTransferred - taxAmount;

  const turnSummary = {
    turn: state.turn,
    effectiveRentIncome,
    arrearsLoss,
    maintenanceCost,
    autoReserveTransferred,
    taxAmount,
    actionExpenses: { ...state.currentTurnExpenses },
    operatingBalance: netTurnChange,
    endingFunds: state.funds,
  };
  state.lastTurnSummary = turnSummary;

  addLog(
    `収入+${effectiveRentIncome}万 / 維持費-${maintenanceCost}万${totalReserveForTax > 0 ? ` / 積立-${totalReserveForTax}万` : ''} / 税金-${taxAmount}万 (残:${state.funds.toLocaleString()}万)`,
    netTurnChange >= 0 ? 'info' : 'warn',
    '決算'
  );

  // 5. 大規模修繕チェック（20・40・60ターン目）
  const repairResult = executeScheduledRepairIfDue();
  if (repairResult.triggered && !repairResult.success) {
    saveGame();
    return {
      status: 'game_over',
      repairResult,
      summary: turnSummary,
    };
  }

  // 6. クリア判定（60ターン目の大規模修繕を乗り切った場合）
  if (state.turn >= GAME_CONFIG.MAX_TURNS) {
    state.isGameClear = true;
    addLog('15年（60ターン）運営達成！ゲームクリア！', 'good', '達成');
    saveGame();
    return {
      status: 'game_clear',
      repairResult,
      summary: turnSummary,
    };
  }

  // 7. 悪質住民の定着ペナルティ適用
  applyBadTenantReputationPenalty();

  // 8. 入居者の自主退去判定と空室家賃5%下落処理
  processTenantsAndVacancyAtTurnEnd();

  // 9. 次ターンへの進行処理
  state.turn += 1;
  // 定期修繕が発動しなかったターンは、前回大規模改修からの経過ターン数を+1（トラブル発生率が上昇）
  if (!repairResult.triggered) {
    state.turnsSinceLastRepair = (state.turnsSinceLastRepair ?? 0) + 1;
  }
  const nextTime = getTimeInfo(state.turn);
  state.year = nextTime.year;
  state.seasonIndex = nextTime.seasonIndex;
  state.currentTurnExpenses = {
    investigation: 0,
    trouble: 0,
    eviction: 0,
    manualReserve: 0,
  };

  // 10. 次ターン開始時の次期家賃一括改定・経年変化・業績変動・新規応募者・新規トラブル抽選
  applyNextTurnRentPolicy();
  processTurnStartAgingAndBusiness();
  generateApplicantsForTurn();
  generateTroublesForTurn();

  saveGame();

  if (repairResult.triggered && repairResult.success) {
    return {
      status: 'repair_completed',
      repairResult,
      summary: turnSummary,
    };
  }

  return {
    status: 'continue',
    repairResult: null,
    summary: turnSummary,
  };
}
