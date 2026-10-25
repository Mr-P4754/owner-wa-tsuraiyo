/**
 * screening.js
 * 入居審査・応募者抽選・追加調査・信憑性ロジック・契約・強制退去処理
 */

import { GAME_CONFIG } from '../config.js';
import { APPLICANT_TEMPLATES } from '../data/applicants.js';
import {
  getState,
  getFloor,
  getVacantFloors,
  addLog,
  updateReputation,
  updateTenantTrust,
  clamp,
  saveGame,
} from '../state.js';

/**
 * 最小値〜最大値（両端含む）のランダムな整数を返す
 * @param {number} min 最小値
 * @param {number} max 最大値
 * @returns {number} ランダム整数
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 空室フロアの募集家賃と評判から、応募対象となる空室フロアを重み付き抽選する
 * @param {Array<object>} vacantFloors 空室フロア配列
 * @param {number} reputation 現在のビル評判
 * @returns {object | null} 選ばれた空室フロア
 */
function pickTargetVacantFloor(vacantFloors, reputation) {
  const eligibleFloors = vacantFloors.filter((floor) => {
    if (reputation < 40 && floor.tier === 'high') {
      return false;
    }
    return true;
  });

  if (eligibleFloors.length === 0) return null;

  const weightedFloors = eligibleFloors.map((floor) => {
    const rentRatio = floor.currentRent / floor.standardRent;
    let weight = 100;

    if (floor.tier === 'low') weight *= 1.3;
    if (floor.tier === 'mid') weight *= 1.0;
    if (floor.tier === 'high') {
      weight *= reputation >= 70 ? 1.2 : 0.65;
    }

    if (rentRatio > 1.0) {
      weight *= Math.max(0.1, Math.pow(1 / rentRatio, 2.8));
      if (Math.random() < (rentRatio - 1.0) * 0.6) {
        weight = 0;
      }
    } else if (rentRatio < 1.0) {
      weight *= 1 + (1.0 - rentRatio) * 1.6;
    }

    return { floor, weight };
  });

  const totalWeight = weightedFloors.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = Math.random() * totalWeight;
  for (const item of weightedFloors) {
    roll -= item.weight;
    if (roll <= 0) {
      return item.floor;
    }
  }
  return weightedFloors[weightedFloors.length - 1].floor;
}

/**
 * ビルの評判と家賃比率に基づき、「見た目カテゴリ」と「内部属性（本性）」を決定する
 * @param {number} reputation ビル評判
 * @param {number} rentRatio 募集家賃 / 初期適正家賃 の比率
 * @returns {{ appearance: 'good'|'normal'|'suspicious', trueNature: 'good'|'normal'|'bad', credibility: number }}
 */
function rollAppearanceAndNature(reputation, rentRatio) {
  let goodWeight = 30;
  let normalWeight = 45;
  let suspiciousWeight = 25;

  if (reputation >= 70) {
    goodWeight = 50;
    normalWeight = 35;
    suspiciousWeight = 15;
  } else if (reputation < 40) {
    goodWeight = 15;
    normalWeight = 35;
    suspiciousWeight = 50;
  }

  const cheapDiscount = Math.max(0, 1.0 - rentRatio);
  if (cheapDiscount > 0) {
    suspiciousWeight += Math.round(cheapDiscount * 80);
    goodWeight = Math.max(5, goodWeight - Math.round(cheapDiscount * 40));
  }

  const totalAppWeight = goodWeight + normalWeight + suspiciousWeight;
  const appRoll = Math.random() * totalAppWeight;
  let appearance = 'normal';
  if (appRoll < goodWeight) {
    appearance = 'good';
  } else if (appRoll < goodWeight + normalWeight) {
    appearance = 'normal';
  } else {
    appearance = 'suspicious';
  }

  let credibility = GAME_CONFIG.APPEARANCE_CATEGORIES[appearance].baseCredibility;
  let trueNature = 'normal';
  const extraBadRisk = cheapDiscount * 0.35;

  if (appearance === 'good') {
    const badProb = 0.1 + extraBadRisk;
    trueNature = Math.random() < badProb ? 'bad' : 'good';
  } else if (appearance === 'normal') {
    const roll = Math.random();
    if (roll < 0.7 - extraBadRisk * 0.5) {
      trueNature = 'normal';
    } else if (roll < 0.85 - extraBadRisk) {
      trueNature = 'good';
    } else {
      trueNature = 'bad';
    }
  } else {
    credibility = randomInt(40, 50);
    const badProb = clamp(credibility / 100 + extraBadRisk * 0.5, 0.35, 0.75);
    trueNature = Math.random() < badProb ? 'bad' : 'good';
  }

  return { appearance, trueNature, credibility };
}

/**
 * 今ターンの入居希望者を抽選・生成する
 */
export function generateApplicantsForTurn() {
  const state = getState();
  state.applicants = [];

  const vacantFloors = getVacantFloors();
  if (vacantFloors.length === 0) {
    return;
  }

  let minApplicants = 2;
  let maxApplicants = 4;
  if (state.reputation >= 70) {
    minApplicants = 3;
    maxApplicants = 5;
  } else if (state.reputation >= 40) {
    minApplicants = 2;
    maxApplicants = 4;
  } else {
    minApplicants = 1;
    maxApplicants = 2;
  }

  const count = randomInt(minApplicants, maxApplicants);
  const usedNames = new Set();

  for (const f of state.floors) {
    if (f.tenant) usedNames.add(f.tenant.name);
  }

  for (let i = 0; i < count; i++) {
    const targetFloor = pickTargetVacantFloor(vacantFloors, state.reputation);
    if (!targetFloor) continue;

    const tier = targetFloor.tier;
    const rentRatio = targetFloor.currentRent / targetFloor.standardRent;
    const { appearance, trueNature, credibility } = rollAppearanceAndNature(
      state.reputation,
      rentRatio
    );

    const tierTemplates = APPLICANT_TEMPLATES[tier] || APPLICANT_TEMPLATES.low;
    let candidates = tierTemplates.filter(
      (t) => t.appearance === appearance && t.trueNature === trueNature && !usedNames.has(t.name)
    );

    if (candidates.length === 0) {
      candidates = tierTemplates.filter(
        (t) => t.appearance === appearance && t.trueNature === trueNature
      );
    }
    if (candidates.length === 0) {
      candidates = tierTemplates.filter((t) => t.appearance === appearance);
    }
    if (candidates.length === 0) {
      candidates = tierTemplates;
    }

    const template = candidates[randomInt(0, candidates.length - 1)];
    usedNames.add(template.name);

    const existingSameNameCount = state.applicants.filter((a) =>
      a.name.startsWith(template.name)
    ).length;
    const displayName =
      existingSameNameCount > 0 ? `${template.name}(${existingSameNameCount + 1})` : template.name;

    state.applicants.push({
      id: `app_${state.turn}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      name: displayName,
      appearance: template.appearance,
      appearanceLabel: GAME_CONFIG.APPEARANCE_CATEGORIES[template.appearance].label,
      trueNature: template.trueNature,
      occupation: template.occupation,
      income: template.income,
      familyStructure: template.familyStructure,
      reviewText: template.reviewText,
      investigationReport: template.investigationReport,
      desiredTier: tier,
      desiredTierName: targetFloor.tierName,
      preferredFloorNumber: targetFloor.floorNumber,
      credibility,
      isInvestigated: false,
    });
  }
}

/**
 * 応募者に対して追加調査（興信所オプション：10万円）を実行する
 * @param {string} applicantId 応募者ID
 * @returns {{ success: boolean, message: string }}
 */
export function investigateApplicant(applicantId) {
  const state = getState();
  const applicant = state.applicants.find((a) => a.id === applicantId);

  if (!applicant) {
    return { success: false, message: '応募者が見つかりません。' };
  }
  if (applicant.isInvestigated) {
    return { success: false, message: '既に調査済みです。' };
  }
  if (state.funds < GAME_CONFIG.INVESTIGATION_COST) {
    return {
      success: false,
      message: `資金不足です（調査には${GAME_CONFIG.INVESTIGATION_COST}万円必要）。`,
    };
  }

  state.funds -= GAME_CONFIG.INVESTIGATION_COST;
  state.currentTurnExpenses.investigation += GAME_CONFIG.INVESTIGATION_COST;
  applicant.isInvestigated = true;
  applicant.credibility = clamp(
    applicant.credibility + GAME_CONFIG.INVESTIGATION_CREDIBILITY_BOOST,
    0,
    100
  );

  addLog(
    `「${applicant.name}」を身辺調査(-${GAME_CONFIG.INVESTIGATION_COST}万)`,
    'info',
    '調査'
  );

  saveGame();
  return {
    success: true,
    message: `調査完了！「${applicant.name}」の本性が判明しました。`,
  };
}

/**
 * 応募者と契約し、指定した空室フロアへ入居させる
 * @param {string} applicantId 応募者ID
 * @param {number} floorNumber 入居先フロア番号
 * @returns {{ success: boolean, message: string }}
 */
export function acceptApplicant(applicantId, floorNumber) {
  const state = getState();
  const applicantIndex = state.applicants.findIndex((a) => a.id === applicantId);
  if (applicantIndex === -1) {
    return { success: false, message: '応募者が見つかりません。' };
  }

  const applicant = state.applicants[applicantIndex];
  const floor = getFloor(floorNumber);

  if (!floor) {
    return { success: false, message: 'フロアが存在しません。' };
  }
  if (floor.tenant !== null) {
    return { success: false, message: `${floor.floorNumber}階は既に入居中です。` };
  }
  if (floor.tier !== applicant.desiredTier) {
    return {
      success: false,
      message: `希望階層（${applicant.desiredTierName}）と異なります。`,
    };
  }

  floor.tenant = {
    id: `tenant_${state.turn}_${floor.floorNumber}_${Math.random().toString(36).slice(2, 6)}`,
    name: applicant.name,
    appearance: applicant.appearance,
    appearanceLabel: applicant.appearanceLabel,
    trueNature: applicant.trueNature,
    occupation: applicant.occupation,
    income: applicant.income,
    familyStructure: applicant.familyStructure,
    trust: GAME_CONFIG.INITIAL_TRUST,
    occupiedTurns: 0,
    isAged: false,
    isInArrears: false,
    businessCondition: 'normal',
    pendingRentNegotiation: null,
    isNatureRevealed: applicant.isInvestigated,
  };
  floor.vacantTurns = 0;
  floor.recentEvent = null; // 退去通知バッジがあれば消去

  state.applicants.splice(applicantIndex, 1);

  addLog(
    `${floor.floorNumber}F(${floor.currentRent}万)に「${applicant.name}」が入居！`,
    'good',
    '契約'
  );

  saveGame();
  return {
    success: true,
    message: `${floor.floorNumber}階に「${applicant.name}」が入居しました。`,
  };
}

/**
 * 応募者の入居を見送る
 * @param {string} applicantId 応募者ID
 * @returns {{ success: boolean, message: string }}
 */
export function rejectApplicant(applicantId) {
  const state = getState();
  const idx = state.applicants.findIndex((a) => a.id === applicantId);
  if (idx === -1) {
    return { success: false, message: '応募者が見つかりません。' };
  }

  const removed = state.applicants.splice(idx, 1)[0];
  addLog(`「${removed.name}」の契約を見送り`, 'info', '見送り');
  saveGame();

  return {
    success: true,
    message: `「${removed.name}」を見送りました。`,
  };
}

/**
 * 強制退去に必要なコストと詳細情報を試算する
 * @param {number} floorNumber 階数
 * @returns {object | null} 立ち退き情報
 */
export function getEvictionPreview(floorNumber) {
  const floor = getFloor(floorNumber);
  if (!floor || !floor.tenant) return null;

  const tenant = floor.tenant;
  const standardEvictionCost = floor.currentRent * GAME_CONFIG.EVICTION_MULTIPLIER_NORMAL;
  const badEvictionCost = floor.currentRent * GAME_CONFIG.EVICTION_MULTIPLIER_BAD;
  const isKnownBad = tenant.isNatureRevealed && tenant.trueNature === 'bad';

  return {
    floorNumber: floor.floorNumber,
    tenantName: tenant.name,
    currentRent: floor.currentRent,
    standardEvictionCost,
    badEvictionCost,
    isKnownBad,
  };
}

/**
 * 入居者に対して強制退去（立ち退き要求）を実行する
 * @param {number} floorNumber 階数
 * @returns {{ success: boolean, isBadTenant: boolean, costPaid: number, message: string }}
 */
export function executeForceEviction(floorNumber) {
  const state = getState();
  const floor = getFloor(floorNumber);

  if (!floor || !floor.tenant) {
    return { success: false, isBadTenant: false, costPaid: 0, message: '入居者がいません。' };
  }

  const tenant = floor.tenant;
  const isBad = tenant.trueNature === 'bad';
  const requiredMultiplier = isBad
    ? GAME_CONFIG.EVICTION_MULTIPLIER_BAD
    : GAME_CONFIG.EVICTION_MULTIPLIER_NORMAL;
  const requiredCost = floor.currentRent * requiredMultiplier;

  const minCost = floor.currentRent * GAME_CONFIG.EVICTION_MULTIPLIER_NORMAL;
  if (state.funds < minCost) {
    return {
      success: false,
      isBadTenant: isBad,
      costPaid: 0,
      message: `資金不足で立ち退き交渉できません（最低 ${minCost}万円 必要）。`,
    };
  }

  if (isBad && state.funds < requiredCost) {
    tenant.isNatureRevealed = true;
    updateTenantTrust(floorNumber, -30);
    updateTenantTrust(floorNumber + 1, -10);
    updateTenantTrust(floorNumber - 1, -10);
    updateReputation(-5);

    const troubleMsg = `${floorNumber}F「${tenant.name}」は悪質住民だったため、5期分(${requiredCost}万)払わないと出ないと居座り騒動が発生！（評判-5・周辺信頼低下）`;
    addLog(troubleMsg, 'bad', '居座り');
    saveGame();

    return {
      success: false,
      isBadTenant: true,
      costPaid: 0,
      message: troubleMsg,
    };
  }

  state.funds -= requiredCost;
  state.currentTurnExpenses.eviction += requiredCost;
  const evictedName = tenant.name;
  floor.tenant = null;
  floor.vacantTurns = 0;
  floor.currentRent = floor.standardRent;
  floor.recentEvent = null;

  const logMessage = isBad
    ? `${floorNumber}F 悪質住民「${evictedName}」に5期分(${requiredCost}万)払い強制退去！`
    : `${floorNumber}F「${evictedName}」に3期分(${requiredCost}万)払い退去させた`;

  addLog(logMessage, isBad ? 'warn' : 'info', '強制退去');
  saveGame();

  return {
    success: true,
    isBadTenant: isBad,
    costPaid: requiredCost,
    message: logMessage,
  };
}
