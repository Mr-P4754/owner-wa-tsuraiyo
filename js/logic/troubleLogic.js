/**
 * troubleLogic.js
 * トラブル抽選・対応処理・上下階波及・経年変化ロジック（簡潔ログ＆ビル断面バッジ連動）
 */

import {
  GAME_CONFIG,
  getBaseTroubleProbability,
  getCurrentPeriodRepairBaseCost,
} from '../config.js';
import {
  TROUBLE_IMPACT_RULES,
  EMERGENCY_REPAIR_IMPACT_RULES,
  EMERGENCY_REPAIR_TEMPLATES,
  TROUBLE_TEMPLATES,
} from '../data/troubles.js';
import {
  getState,
  getFloor,
  getOccupiedFloors,
  addLog,
  updateReputation,
  updateTenantTrust,
  saveGame,
} from '../state.js';

/**
 * ターン開始時に入居中フロアからトラブルイベントを抽選・生成する
 * ・上限件数なし（発生数は完全に発生率に依存）
 * ・低確率でビル全体の「緊急大規模改修」トラブル（3パターンから選択可）が発生する
 * ・1入居者につき複数回抽選を行い、同一フロアで2件以上同時発生することもある
 * ・対応費用は階層倍率（低層×1.0 / 中層×2.2 / 高層×4.0）でスケーリングされる
 */
export function generateTroublesForTurn() {
  const state = getState();
  state.troubles = [];

  const occupiedFloors = getOccupiedFloors();
  if (occupiedFloors.length === 0) return;

  const turnsElapsed = state.turnsSinceLastRepair ?? 0;
  const baseProb = getBaseTroubleProbability(turnsElapsed);

  // 1. 低確率で「緊急大規模改修」トラブルを抽選（初期5%・1期ごとに+0.25%上昇・最大10%）
  const emergencyProb = Math.min(
    GAME_CONFIG.EMERGENCY_REPAIR_MAX_PROB ?? 0.10,
    (GAME_CONFIG.EMERGENCY_REPAIR_BASE_PROB ?? 0.05) +
      turnsElapsed * (GAME_CONFIG.EMERGENCY_REPAIR_PROB_INCREASE_PER_TURN ?? 0.0025)
  );
  if (Math.random() < emergencyProb) {
    const emTemplate =
      EMERGENCY_REPAIR_TEMPLATES[Math.floor(Math.random() * EMERGENCY_REPAIR_TEMPLATES.length)];
    const repairBaseCost = getCurrentPeriodRepairBaseCost(state.turn, state.totalFloors || 10);
    const costA = repairBaseCost;
    const costB = Math.round(repairBaseCost * 0.4);

    state.troubles.push({
      id: `trb_em_${state.turn}_${Math.random().toString(36).slice(2, 6)}`,
      isEmergencyRepair: true,
      floorNumber: 0,
      tier: 'building',
      tierName: 'ビル全館',
      costMultiplier: 1.0,
      tenantName: `全入居フロア（${occupiedFloors.length}室）`,
      templateId: emTemplate.id,
      title: emTemplate.title,
      category: 'emergency_repair',
      description: emTemplate.description,
      baseRepairCost: repairBaseCost,
      costA,
      costB,
      resolved: false,
    });

    addLog(
      `🚨 ビル全館「${emTemplate.title}」発生！（ベース費用:${repairBaseCost.toLocaleString()}万）`,
      'bad',
      '緊急改修'
    );
  }

  // 2. 各入居フロアごとの個別トラブル抽選（件数上限なし・発生率に完全依存）
  const candidates = [];

  for (const floor of occupiedFloors) {
    const tenant = floor.tenant;
    let prob = baseProb;
    let rolls = GAME_CONFIG.TROUBLE_ROLLS_PER_TENANT || 2;

    if (tenant.trueNature === 'bad') {
      prob = Math.min(0.85, baseProb * 1.55 + 0.12);
      rolls += 1; // 悪質住民は最大3件まで同時発生し得る
    } else if (tenant.isAged) {
      prob = Math.min(0.78, baseProb * 1.25 + 0.05);
    } else if (tenant.trueNature === 'good') {
      prob = Math.min(0.68, baseProb * 0.85);
    }

    for (let r = 0; r < rolls; r++) {
      const rollProb = r === 0 ? prob : prob * 0.75;
      if (Math.random() < rollProb) {
        candidates.push(floor);
      }
    }
  }

  // 表示順を見やすくするため階数の降順でソート（上限10件のスライスは撤廃）
  candidates.sort((a, b) => b.floorNumber - a.floorNumber);
  const selectedFloors = candidates;

  // 同一フロアで同じトラブル名が重複しないように管理
  const usedTemplatesByFloor = new Map();

  for (const floor of selectedFloors) {
    const tenant = floor.tenant;
    if (!usedTemplatesByFloor.has(floor.floorNumber)) {
      usedTemplatesByFloor.set(floor.floorNumber, new Set());
    }
    const usedSet = usedTemplatesByFloor.get(floor.floorNumber);

    const availableTemplates = TROUBLE_TEMPLATES.filter((t) => {
      if (usedSet.has(t.id)) return false;
      if (!t.allowedTiers.includes(floor.tier)) return false;
      if (t.category === 'bad_tenant' && tenant.trueNature !== 'bad') return false;
      if (t.category === 'aged' && !tenant.isAged) return false;
      return true;
    });

    if (availableTemplates.length === 0) continue;

    let pickedTemplate =
      availableTemplates[Math.floor(Math.random() * availableTemplates.length)];
    if (tenant.trueNature === 'bad') {
      const badSpecial = availableTemplates.find((t) => t.category === 'bad_tenant');
      if (badSpecial && Math.random() < 0.65) {
        pickedTemplate = badSpecial;
        tenant.isNatureRevealed = true;
      }
    } else if (tenant.isAged) {
      const agedSpecial = availableTemplates.find((t) => t.category === 'aged');
      if (agedSpecial && Math.random() < 0.6) {
        pickedTemplate = agedSpecial;
      }
    }

    usedSet.add(pickedTemplate.id);

    // 階層別の対応費用倍率（低層×1.0 / 中層×2.2 / 高層×4.0）を反映
    const tierMult = GAME_CONFIG.TROUBLE_COST_MULTIPLIER[floor.tier] || 1.0;
    const scaledCostA = Math.max(10, Math.round((pickedTemplate.costA * tierMult) / 5) * 5);
    const scaledCostB = Math.max(5, Math.round((pickedTemplate.costB * tierMult) / 5) * 5);

    state.troubles.push({
      id: `trb_${state.turn}_${floor.floorNumber}_${Math.random().toString(36).slice(2, 6)}`,
      floorNumber: floor.floorNumber,
      tier: floor.tier,
      tierName: floor.tierName,
      costMultiplier: tierMult,
      tenantName: tenant.name,
      templateId: pickedTemplate.id,
      title: pickedTemplate.title,
      category: pickedTemplate.category,
      description: pickedTemplate.description,
      costA: scaledCostA,
      costB: scaledCostB,
      choiceTexts: pickedTemplate.choiceTexts,
      resolved: false,
    });

    addLog(
      `${floor.floorNumber}F(${floor.tierName})「${pickedTemplate.title}」発生！`,
      'warn',
      'トラブル'
    );
  }
}

/**
 * トラブルに対するオーナーの対応（A / B / C）を実行し、上下階への波及を反映する
 * @param {string} troubleId トラブルID
 * @param {'A' | 'B' | 'C'} choiceKey 選択肢キー
 * @param {boolean} isAutoSalt ターン終了時の未対応による自動塩対応かどうか
 * @returns {{ success: boolean, message: string }}
 */
export function resolveTrouble(troubleId, choiceKey, isAutoSalt = false) {
  const state = getState();
  const troubleIndex = state.troubles.findIndex((t) => t.id === troubleId);
  if (troubleIndex === -1) {
    return { success: false, message: '対象のトラブルが見つかりません。' };
  }

  const trouble = state.troubles[troubleIndex];

  // --- 緊急大規模改修トラブルの3択対応処理 ---
  if (trouble.isEmergencyRepair) {
    const emRule = EMERGENCY_REPAIR_IMPACT_RULES[choiceKey];
    if (!emRule) {
      return { success: false, message: '無効な選択肢です。' };
    }

    let cost = 0;
    if (choiceKey === 'A') cost = trouble.costA;
    if (choiceKey === 'B') cost = trouble.costB;

    const totalAvailable = state.repairReserve + Math.max(0, state.funds);
    if (cost > totalAvailable) {
      return {
        success: false,
        message: `修繕積立金と手元資金の合計が不足しています（必要: ${cost.toLocaleString()}万円）。`,
      };
    }

    let paidFromReserve = 0;
    let paidFromFunds = 0;
    if (cost > 0) {
      paidFromReserve = Math.min(state.repairReserve, cost);
      paidFromFunds = cost - paidFromReserve;
      state.repairReserve -= paidFromReserve;
      state.funds -= paidFromFunds;
      state.currentTurnExpenses.trouble += paidFromFunds;
    }

    // 全入居フロアの信頼度を増減
    const occupied = getOccupiedFloors();
    for (const f of occupied) {
      updateTenantTrust(f.floorNumber, emRule.allTrustDelta);
    }

    if (emRule.reputationDelta !== 0) {
      updateReputation(emRule.reputationDelta);
    }

    // 設備劣化（トラブル発生率カウント）への反映
    if (choiceKey === 'A') {
      state.turnsSinceLastRepair = 0;
    } else if (choiceKey === 'B') {
      state.turnsSinceLastRepair = Math.floor((state.turnsSinceLastRepair ?? 0) / 2);
    } else {
      state.turnsSinceLastRepair = (state.turnsSinceLastRepair ?? 0) + 3;
    }

    state.troubles.splice(troubleIndex, 1);

    const autoPrefix = isAutoSalt ? '[放置] ' : '';
    const payDetail =
      cost > 0
        ? `(-${cost.toLocaleString()}万 [積立-${paidFromReserve.toLocaleString()}万/手元-${paidFromFunds.toLocaleString()}万])`
        : '(0円)';
    const logMsg = `${autoPrefix}${trouble.title} 対応${choiceKey}${payDetail} 全室信頼${emRule.allTrustDelta >= 0 ? '+' : ''}${emRule.allTrustDelta} / 評判${emRule.reputationDelta >= 0 ? '+' : ''}${emRule.reputationDelta}`;
    const logType = choiceKey === 'A' ? 'good' : choiceKey === 'B' ? 'info' : 'bad';
    addLog(logMsg, logType, '緊急改修対応');
    saveGame();

    return {
      success: true,
      message: logMsg,
    };
  }

  // --- 通常フロアトラブルの3択対応処理 ---
  const rule = TROUBLE_IMPACT_RULES[choiceKey];
  if (!rule) {
    return { success: false, message: '無効な選択肢です。' };
  }

  let cost = 0;
  if (choiceKey === 'A') cost = trouble.costA;
  if (choiceKey === 'B') cost = trouble.costB;

  if (cost > state.funds) {
    return {
      success: false,
      message: `手元資金が不足しています（必要: ${cost}万円）。`,
    };
  }

  if (cost > 0) {
    state.funds -= cost;
    state.currentTurnExpenses.trouble += cost;
  }

  const actualSelfDelta = updateTenantTrust(trouble.floorNumber, rule.selfTrustDelta);

  const affectedNeighbors = [];
  if (rule.neighborTrustDelta !== 0) {
    const upperFloor = getFloor(trouble.floorNumber + 1);
    const lowerFloor = getFloor(trouble.floorNumber - 1);

    if (upperFloor && upperFloor.tenant) {
      const d = updateTenantTrust(upperFloor.floorNumber, rule.neighborTrustDelta);
      affectedNeighbors.push(`${upperFloor.floorNumber}F(${d})`);
    }
    if (lowerFloor && lowerFloor.tenant) {
      const d = updateTenantTrust(lowerFloor.floorNumber, rule.neighborTrustDelta);
      affectedNeighbors.push(`${lowerFloor.floorNumber}F(${d})`);
    }
  }

  if (rule.reputationDelta !== 0) {
    updateReputation(rule.reputationDelta);
  }

  state.troubles.splice(troubleIndex, 1);

  const neighborText =
    affectedNeighbors.length > 0 ? ` / 上下階:${affectedNeighbors.join(',')}` : '';
  const repText =
    rule.reputationDelta !== 0
      ? ` / 評判${rule.reputationDelta > 0 ? '+' : ''}${rule.reputationDelta}`
      : '';
  const autoPrefix = isAutoSalt ? '[放置] ' : '';

  const logMsg = `${autoPrefix}${trouble.floorNumber}F「${trouble.title}」対応${choiceKey}(-${cost}万) 信頼${actualSelfDelta >= 0 ? '+' : ''}${actualSelfDelta}${neighborText}${repText}`;

  const logType = choiceKey === 'A' ? 'good' : choiceKey === 'B' ? 'info' : 'bad';
  addLog(logMsg, logType, '対応完了');
  saveGame();

  return {
    success: true,
    message: logMsg,
  };
}

/**
 * ターン開始時の経年変化イベント（低層階の高齢化・滞納判定、中層階の春の業績判定）を処理する
 */
export function processTurnStartAgingAndBusiness() {
  const state = getState();
  const isSpring = state.seasonIndex === 0;

  for (const floor of state.floors) {
    const tenant = floor.tenant;
    if (!tenant) continue;

    tenant.isInArrears = false;
    tenant.pendingRentNegotiation = null;

    // 1. 低層階の高齢化判定（入居20ターン経過）
    if (
      floor.tier === 'low' &&
      !tenant.isAged &&
      tenant.occupiedTurns >= GAME_CONFIG.AGING_THRESHOLD_TURNS
    ) {
      tenant.isAged = true;
      addLog(
        `${floor.floorNumber}F「${tenant.name}」が高齢世帯になりました（修繕協力的・滞納リスク有）`,
        'warn',
        '高齢化'
      );
    }

    // 2. 高齢世帯の毎ターン家賃滞納判定（15%）
    if (tenant.isAged) {
      if (Math.random() < GAME_CONFIG.AGING_ARREARS_PROBABILITY) {
        tenant.isInArrears = true;
        addLog(
          `${floor.floorNumber}F「${tenant.name}」が今期家賃(${floor.currentRent}万)を滞納`,
          'bad',
          '滞納'
        );
      }
    }

    // 3. 中層階の業績変動（毎年「春」ターンに判定）
    if (floor.tier === 'mid' && isSpring && tenant.occupiedTurns >= 1) {
      const roll = Math.random();
      if (roll < 0.28) {
        tenant.businessCondition = 'good';
        const proposedRent = Math.min(
          Math.round(floor.standardRent * GAME_CONFIG.MAX_RENT_RATIO),
          Math.round(floor.currentRent * 1.12)
        );
        if (proposedRent > floor.currentRent) {
          tenant.pendingRentNegotiation = {
            type: 'up',
            proposedRent,
            currentRent: floor.currentRent,
          };
          addLog(
            `${floor.floorNumber}F「${tenant.name}」業績好調！家賃UP(${floor.currentRent}→${proposedRent}万)可能`,
            'good',
            '家賃交渉'
          );
        }
      } else if (roll < 0.56) {
        tenant.businessCondition = 'bad';
        const minRent = Math.round(floor.standardRent * GAME_CONFIG.MIN_RENT_RATIO);
        const proposedRent = Math.max(minRent, Math.round(floor.currentRent * 0.88));
        if (proposedRent < floor.currentRent) {
          tenant.pendingRentNegotiation = {
            type: 'down',
            proposedRent,
            currentRent: floor.currentRent,
          };
          addLog(
            `${floor.floorNumber}F「${tenant.name}」業績悪化で減額要請(${floor.currentRent}→${proposedRent}万)`,
            'warn',
            '減額交渉'
          );
        }
      } else {
        tenant.businessCondition = 'normal';
      }
    }
  }
}

/**
 * 中層階テナントの春季家賃交渉（値上げ実行 / 値下げ受入 / 据え置き）を処理する
 * @param {number} floorNumber 階数
 * @param {'accept' | 'keep'} action 'accept': 改定を実行 / 'keep': 現家賃のまま据え置き
 * @returns {{ success: boolean, message: string }}
 */
export function resolveRentNegotiation(floorNumber, action) {
  const floor = getFloor(floorNumber);
  if (!floor || !floor.tenant || !floor.tenant.pendingRentNegotiation) {
    return { success: false, message: '現在このフロアに家賃交渉はありません。' };
  }

  const tenant = floor.tenant;
  const neg = tenant.pendingRentNegotiation;
  tenant.pendingRentNegotiation = null;

  if (neg.type === 'up') {
    if (action === 'accept') {
      const oldRent = floor.currentRent;
      floor.currentRent = neg.proposedRent;
      const msg = `${floor.floorNumber}F 家賃を ${oldRent}万 → ${floor.currentRent}万 に増額！`;
      addLog(msg, 'good', '家賃増額');
      saveGame();
      return { success: true, message: msg };
    } else {
      const d = updateTenantTrust(floor.floorNumber, 10);
      const msg = `${floor.floorNumber}F 家賃据置で感謝された（信頼+${d}）`;
      addLog(msg, 'good', '家賃据置');
      saveGame();
      return { success: true, message: msg };
    }
  } else {
    if (action === 'accept') {
      const oldRent = floor.currentRent;
      floor.currentRent = neg.proposedRent;
      const d = updateTenantTrust(floor.floorNumber, 10);
      const msg = `${floor.floorNumber}F 家賃を ${oldRent}万 → ${floor.currentRent}万 に減額（信頼+${d}）`;
      addLog(msg, 'info', '家賃減額');
      saveGame();
      return { success: true, message: msg };
    } else {
      const d = updateTenantTrust(floor.floorNumber, -15);
      const msg = `${floor.floorNumber}F 減額要請を拒否（信頼${d}）`;
      addLog(msg, 'warn', '交渉拒否');
      saveGame();
      return { success: true, message: msg };
    }
  }
}

/**
 * ターン終了時の「悪質住民の定着ペナルティ（輩が輩を呼ぶ連鎖）」を適用する
 * @returns {{ badCount: number, totalPenalty: number }}
 */
export function applyBadTenantReputationPenalty() {
  const occupiedFloors = getOccupiedFloors();
  const badFloors = occupiedFloors.filter((f) => f.tenant.trueNature === 'bad');
  const badCount = badFloors.length;

  if (badCount === 0) {
    return { badCount: 0, totalPenalty: 0 };
  }

  const totalPenalty = badCount * GAME_CONFIG.BAD_TENANT_REPUTATION_PENALTY;
  updateReputation(-totalPenalty);

  addLog(
    `悪質住民(${badCount}室)の影響でビル評判 -${totalPenalty} 低下`,
    'bad',
    '評判低下'
  );

  return { badCount, totalPenalty };
}
