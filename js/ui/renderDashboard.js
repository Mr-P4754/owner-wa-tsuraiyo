/**
 * renderDashboard.js
 * ヘッダーHUD・Three.js 3Dビル断面ビューア連動・バッジ・フッター更新モジュール
 */

import { GAME_CONFIG } from '../config.js';
import {
  getState,
  getTimeInfo,
  getOccupiedFloors,
  getAverageTrust,
  getBuildingEventCount,
  calculateExpectedTurnCashflow,
} from '../state.js';
import { getNextRepairScheduleInfo, calculateRepairBreakdown } from '../logic/repairLogic.js';
import { initTower3D, updateTower3DFromState, handleResize } from './tower3d.js?v=20261026b';

/**
 * 入居者または応募者のプロフィールからキャラクターアバター絵文字を決定する
 * @param {object} person 入居者または応募者オブジェクト
 * @param {string} tier 階層ID ('low' | 'mid' | 'high')
 * @returns {string} キャラクター絵文字
 */
export function getCharacterAvatar(person, tier = 'low') {
  if (!person) return '🚪';
  if (person.isAged) return '👵';
  if (person.isNatureRevealed && person.trueNature === 'bad') return '🦹';

  const name = person.name || '';
  const occ = person.occupation || '';

  if (name.includes('鬼塚') || occ.includes('建築') || occ.includes('内装')) return '👷‍♂️';
  if (name.includes('紅林') || occ.includes('塗装') || occ.includes('デザイン')) return '🧑‍🎤';
  if (
    name.includes('黒崎') ||
    name.includes('毒島') ||
    name.includes('皇龍') ||
    name.includes('鳳凰') ||
    name.includes('鬼頭') ||
    name.includes('夜桜')
  )
    return '🕶️';
  if (name.includes('エレナ') || occ.includes('バイオリン') || occ.includes('オペラ')) return '🎻';
  if (name.includes('一条') || name.includes('九条') || name.includes('鷹司') || occ.includes('理事長'))
    return '👑';
  if (name.includes('DJ') || name.includes('SHUN') || occ.includes('暗号資産')) return '🕺';
  if (name.includes('謎の青年') || occ.includes('AI') || occ.includes('研究')) return '🧑‍💻';
  if (name.includes('西園寺') || name.includes('シャルロット') || name.includes('王')) return '🎩';
  if (name.includes('神崎') || name.includes('桐生') || occ.includes('小説家') || occ.includes('映画'))
    return '✍️';
  if (occ.includes('税理士') || occ.includes('会計') || occ.includes('法律') || occ.includes('司法'))
    return '📊';
  if (occ.includes('システム') || occ.includes('IT') || occ.includes('データ')) return '💻';
  if (occ.includes('塾') || occ.includes('教員') || occ.includes('保育')) return '🎓';
  if (occ.includes('ゲーム') || occ.includes('Web') || occ.includes('動画') || occ.includes('VTuber'))
    return '🎮';
  if (occ.includes('時計') || occ.includes('アート') || occ.includes('画廊')) return '⌚';
  if (occ.includes('投資') || occ.includes('セミナー') || occ.includes('コンサル')) return '💼';
  if (occ.includes('薬剤師') || occ.includes('看護') || occ.includes('歯科') || occ.includes('クリニック'))
    return '👩‍⚕️';
  if (occ.includes('消防') || occ.includes('自衛官') || occ.includes('パイロット')) return '🧑‍🚒';
  if (occ.includes('パン') || occ.includes('和菓子') || occ.includes('シェフ')) return '👨‍🍳';
  if (name.includes('夫妻') || name.includes('ファミリー') || name.includes('一家')) return '👨‍👩‍👦';

  if (person.appearance === 'suspicious') return '😎';
  if (tier === 'high') return '💎';
  if (tier === 'mid') return '🏢';
  return '🧑';
}

/**
 * 入居者の現在の信頼度やトラブル状態に応じた感情アイコンを返す
 * @param {object} tenant 入居者オブジェクト
 * @param {boolean} hasTrouble トラブル発生中か
 * @returns {string} 感情アイコン絵文字
 */
export function getMoodEmoji(tenant, hasTrouble) {
  if (hasTrouble) return '🔥';
  if (tenant.isInArrears) return '💸';
  if (tenant.trust <= GAME_CONFIG.LOW_TRUST_THRESHOLD) return '😡';
  if (tenant.trust < 45) return '😒';
  if (tenant.trust >= 80) return '😍';
  if (tenant.trust >= 60) return '😊';
  return '🙂';
}

/**
 * ヘッダーHUDおよび季節背景クラスを更新する
 */
export function renderHeader() {
  const state = getState();
  const timeInfo = getTimeInfo(state.turn);
  const cashflow = calculateExpectedTurnCashflow();
  const nextRepair = getNextRepairScheduleInfo(state.turn);
  const repairEst = calculateRepairBreakdown(nextRepair.baseCost);
  const avgTrust = getAverageTrust(false);
  const occupiedCount = getOccupiedFloors().length;

  const seasonClasses = ['season-spring', 'season-summer', 'season-autumn', 'season-winter'];
  const seasonIcons = ['🌸', '☀️', '🍁', '❄️'];
  document.body.classList.remove(...seasonClasses);
  document.body.classList.add(seasonClasses[timeInfo.seasonIndex] || 'season-spring');

  const elSeasonIcon = document.getElementById('header-season-icon');
  const elYearSeason = document.getElementById('header-year-season');
  const elTurnCount = document.getElementById('header-turn-count');
  const elTurnBar = document.getElementById('header-turn-bar');

  const elFunds = document.getElementById('header-funds');
  const elExpectedNet = document.getElementById('header-expected-net');

  const elReserve = document.getElementById('header-reserve');
  const elNextRepair = document.getElementById('header-next-repair');
  const elReserveBar = document.getElementById('header-reserve-bar');

  const elReputation = document.getElementById('header-reputation');
  const elRepRank = document.getElementById('header-reputation-rank');
  const elReputationBar = document.getElementById('header-reputation-bar');

  const elTrust = document.getElementById('header-trust');
  const elOccSub = document.getElementById('header-occupancy-sub');
  const elTrustBar = document.getElementById('header-trust-bar');

  if (elSeasonIcon) elSeasonIcon.textContent = seasonIcons[timeInfo.seasonIndex] || '🌸';
  if (elYearSeason) elYearSeason.textContent = timeInfo.formatted;
  if (elTurnCount) elTurnCount.textContent = `${state.turn}/${GAME_CONFIG.MAX_TURNS}`;
  if (elTurnBar) elTurnBar.style.width = `${Math.round((state.turn / GAME_CONFIG.MAX_TURNS) * 100)}%`;

  if (elFunds) {
    elFunds.textContent = `${state.funds.toLocaleString()}万`;
    elFunds.className = `hud-value ${state.funds < 350 ? 'text-negative' : ''}`;
  }
  if (elExpectedNet) {
    const sign = cashflow.netCashflow >= 0 ? '+' : '';
    elExpectedNet.textContent = `${sign}${cashflow.netCashflow.toLocaleString()}万`;
    elExpectedNet.className = `hud-sub ${cashflow.netCashflow >= 0 ? 'text-positive' : 'text-negative'}`;
  }

  if (elReserve) {
    elReserve.textContent = `${state.repairReserve.toLocaleString()}万`;
  }
  if (elNextRepair) {
    elNextRepair.textContent =
      nextRepair.turnsRemaining === 0 ? `今期修繕!` : `残${nextRepair.turnsRemaining}T`;
  }
  if (elReserveBar) {
    const reserveProgress =
      repairEst.ownerBurden > 0
        ? Math.min(100, Math.round((state.repairReserve / repairEst.ownerBurden) * 100))
        : 100;
    elReserveBar.style.width = `${reserveProgress}%`;
  }

  if (elReputation) elReputation.textContent = `${state.reputation}`;
  if (elRepRank) {
    if (state.reputation >= 70) {
      elRepRank.textContent = '好調';
      elRepRank.className = 'hud-sub text-positive';
    } else if (state.reputation < 40) {
      elRepRank.textContent = '低迷';
      elRepRank.className = 'hud-sub text-negative';
    } else {
      elRepRank.textContent = '標準';
      elRepRank.className = 'hud-sub';
    }
  }
  if (elReputationBar) elReputationBar.style.width = `${state.reputation}%`;

  if (elTrust) {
    elTrust.textContent = occupiedCount > 0 ? `${avgTrust}` : `--`;
  }
  if (elOccSub) {
    elOccSub.textContent = `${occupiedCount}/${state.totalFloors}室`;
  }
  if (elTrustBar) {
    elTrustBar.style.width = `${occupiedCount > 0 ? avgTrust : 0}%`;
  }
}

/**
 * 左カラム：Three.js 3Dビルディングと上部バッジを更新する
 * @param {Function} onStateChanged 状態更新時の再描画コールバック
 */
export function renderBuildingList(onStateChanged) {
  const roofEventBadge = document.getElementById('building-event-badge');
  const buildingEventCount = getBuildingEventCount();

  if (roofEventBadge) {
    roofEventBadge.textContent = `🔔 ${buildingEventCount}件`;
    roofEventBadge.classList.toggle('hidden', buildingEventCount === 0);
  }

  // Three.js 3Dシーンの初期化または状態同期
  initTower3D('floor-list-container', onStateChanged);
  updateTower3DFromState();
  requestAnimationFrame(() => handleResize());
}

/**
 * タブバッジ（ビル断面の退去・家賃交渉バッジ含む）およびフッターを更新する
 */
export function renderBadgesAndFooter() {
  const state = getState();

  const badgeBuilding = document.getElementById('badge-building');
  const badgeScreening = document.getElementById('badge-screening');
  const badgeTrouble = document.getElementById('badge-trouble');
  const badgeLog = document.getElementById('badge-log');
  const footerMsg = document.getElementById('footer-status-msg');
  const nextTurnBtn = document.getElementById('btn-next-turn');

  const buildingEventCount = getBuildingEventCount();

  if (badgeBuilding) {
    badgeBuilding.textContent = String(buildingEventCount);
    badgeBuilding.classList.toggle('hidden', buildingEventCount === 0);
  }

  if (badgeScreening) {
    badgeScreening.textContent = String(state.applicants.length);
    badgeScreening.classList.toggle('hidden', state.applicants.length === 0);
  }

  if (badgeTrouble) {
    badgeTrouble.textContent = String(state.troubles.length);
    badgeTrouble.classList.toggle('hidden', state.troubles.length === 0);
  }

  if (badgeLog) {
    badgeLog.classList.toggle('hidden', !state.hasUnreadLog);
  }

  if (footerMsg) {
    if (state.isGameOver) {
      footerMsg.innerHTML = `<span class="text-negative">🚨 ${state.gameOverReason}</span>`;
    } else if (state.isGameClear) {
      footerMsg.innerHTML = `<span class="text-positive">🎉 15年（60ターン）運営達成！</span>`;
    } else if (state.troubles.length > 0) {
      footerMsg.innerHTML = `<span class="text-warning">⚡ 未対応トラブル <strong>${state.troubles.length}件</strong></span>`;
    } else if (buildingEventCount > 0) {
      footerMsg.innerHTML = `<span class="text-warning">🔔 退去・家賃交渉の通知 <strong>${buildingEventCount}件</strong></span>`;
    } else if (state.applicants.length > 0) {
      footerMsg.innerHTML = `📋 入居審査待ち <strong>${state.applicants.length}組</strong>`;
    } else {
      footerMsg.textContent = `確認完了後「次の季節へ」で進行します。`;
    }
  }

  if (nextTurnBtn) {
    nextTurnBtn.disabled = state.isGameOver || state.isGameClear;
  }
}
