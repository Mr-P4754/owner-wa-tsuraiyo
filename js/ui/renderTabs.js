/**
 * renderTabs.js
 * 右カラム5タブ（ビル通知・入居審査・トラブル・階層別維持費対応の財務・ログ）の描画モジュール
 */

import { GAME_CONFIG } from '../config.js';
import {
  getState,
  getVacantFloors,
  calculateExpectedTurnCashflow,
  transferToRepairReserve,
  setAutoReserveAmount,
  setNextRentPolicy,
  getNextRentPolicyPreview,
} from '../state.js';
import {
  investigateApplicant,
  acceptApplicant,
  rejectApplicant,
} from '../logic/screening.js';
import { resolveTrouble } from '../logic/troubleLogic.js';
import {
  getNextRepairScheduleInfo,
  calculateRepairBreakdown,
  getExtraRepairInfo,
} from '../logic/repairLogic.js';
import { getCharacterAvatar } from './renderDashboard.js';
import {
  showFloorDetailModal,
  showExtraRepairConfirmModal,
  showCustomModal,
  closeModal,
} from './modal.js';

/** ログタブで現在表示中のページ番号（0始まり） */
let currentLogPage = 0;

/** 1ページあたりのログ表示件数 */
const LOGS_PER_PAGE = 6;

/** 審査タブの展開中カードIDセット */
const expandedTabApplicantIds = new Set();

/** トラブルタブの展開中カードIDセット */
const expandedTabTroubleIds = new Set();

/**
 * 見た目カテゴリのバッジクラスを返す
 * @param {string} appearance 見た目ID
 * @returns {string} CSSクラス名
 */
function getAppearanceClass(appearance) {
  if (appearance === 'good') return 'tag-good';
  if (appearance === 'suspicious') return 'tag-suspicious';
  return 'tag-normal';
}

/**
 * タブ0：ビル断面イベントタブ（PC表示時に退去情報・家賃交渉カードを一覧表示）
 * @param {HTMLElement} container 描画先コンテナ
 * @param {Function} onStateChanged 状態更新コールバック
 */
function renderBuildingEventsTab(container, onStateChanged) {
  const state = getState();
  const eventFloors = state.floors.filter(
    (f) => Boolean(f.recentEvent) || Boolean(f.tenant && f.tenant.pendingRentNegotiation)
  );

  const hintBar = document.createElement('div');
  hintBar.className = 'section-hint-bar';
  hintBar.innerHTML = `
    <span>🔔 退去・家賃交渉（${eventFloors.length}件）</span>
  `;
  container.appendChild(hintBar);

  if (eventFloors.length === 0) {
    container.innerHTML += `
      <div class="empty-visual-state">
        <div class="empty-visual-icon">🏢✨</div>
        <div style="font-size:14px; font-weight:900; color:#fff;">退去・家賃交渉の通知はありません</div>
        <p>左の3Dビルから各階をタップすると、部屋の詳細や家賃設定・強制退去が行えます。</p>
      </div>
    `;
    return;
  }

  const list = document.createElement('div');
  list.className = 'tap-card-list';

  for (const floor of eventFloors) {
    const card = document.createElement('div');
    card.className = 'summary-tap-card card-event';

    if (floor.recentEvent) {
      card.innerHTML = `
        <div class="tap-card-avatar">👋</div>
        <div class="tap-card-main">
          <div class="tap-card-title">
            <span class="mini-tag tag-event">${floor.floorNumber}F</span>
            <span>${floor.recentEvent.label}</span>
          </div>
          <div class="tap-card-sub">${floor.recentEvent.detail}</div>
        </div>
        <span class="tap-card-arrow">確認 ▶</span>
      `;
    } else if (floor.tenant && floor.tenant.pendingRentNegotiation) {
      const neg = floor.tenant.pendingRentNegotiation;
      const isUp = neg.type === 'up';
      card.innerHTML = `
        <div class="tap-card-avatar">${isUp ? '📈' : '📉'}</div>
        <div class="tap-card-main">
          <div class="tap-card-title">
            <span class="mini-tag tag-event">${floor.floorNumber}F</span>
            <span>${floor.tenant.name}</span>
          </div>
          <div class="tap-card-sub">
            ${isUp ? '家賃UP提案' : '減額要請'}（${neg.currentRent}万 ➔ ${neg.proposedRent}万）
          </div>
        </div>
        <span class="tap-card-arrow">交渉 ▶</span>
      `;
    }

    card.addEventListener('click', () => {
      showFloorDetailModal(floor, onStateChanged);
    });
    list.appendChild(card);
  }

  container.appendChild(list);
}

/**
 * タブ1：入居審査タブ（折り畳み式アコーディオンカード一覧 ➔ 複数展開して比較・契約可能）
 * @param {HTMLElement} container 描画先コンテナ
 * @param {Function} onStateChanged 状態更新コールバック
 */
function renderScreeningTab(container, onStateChanged) {
  const state = getState();
  const vacantFloors = getVacantFloors();

  if (vacantFloors.length === 0) {
    container.innerHTML = `
      <div class="empty-visual-state">
        <div class="empty-visual-icon">🏢✨</div>
        <div style="font-size:14px; font-weight:900; color:#fff;">全10フロア満室</div>
        <p>空室がないため新規募集はありません。</p>
      </div>
    `;
    return;
  }

  if (state.applicants.length === 0) {
    container.innerHTML = `
      <div class="empty-visual-state">
        <div class="empty-visual-icon">📋✅</div>
        <div style="font-size:14px; font-weight:900; color:#fff;">今期の審査は完了しました</div>
        <p>「次の季節へ」で新しい応募者が現れます。</p>
      </div>
    `;
    return;
  }

  const totalApps = state.applicants.length;
  const allExpanded =
    totalApps > 0 && state.applicants.every((a) => expandedTabApplicantIds.has(a.id));

  const hintBar = document.createElement('div');
  hintBar.className = 'section-hint-bar';
  hintBar.innerHTML = `
    <span>📋 入居希望者（${totalApps}組）</span>
    <div style="display:flex; align-items:center; gap:6px;">
      <button type="button" id="btn-scr-expand-all" class="btn btn-outline btn-xs">
        ${allExpanded ? '📁 全収納' : '📂 全展開'}
      </button>
    </div>
  `;
  container.appendChild(hintBar);

  const btnScrExpandAll = hintBar.querySelector('#btn-scr-expand-all');
  if (btnScrExpandAll) {
    btnScrExpandAll.addEventListener('click', () => {
      if (allExpanded) {
        state.applicants.forEach((a) => expandedTabApplicantIds.delete(a.id));
      } else {
        state.applicants.forEach((a) => expandedTabApplicantIds.add(a.id));
      }
      onStateChanged();
    });
  }

  const list = document.createElement('div');
  list.className = 'tap-card-list';

  for (const app of state.applicants) {
    const isExpanded = expandedTabApplicantIds.has(app.id);
    const avatarEmoji = getCharacterAvatar(app, app.desiredTier);
    const tierVacantFloors = vacantFloors
      .filter((f) => f.tier === app.desiredTier)
      .sort((a, b) => a.floorNumber - b.floorNumber);

    let floorOptionsHtml = '';
    for (const vf of tierVacantFloors) {
      const sel = vf.floorNumber === app.preferredFloorNumber ? 'selected' : '';
      floorOptionsHtml += `<option value="${vf.floorNumber}" ${sel}>${vf.floorNumber}F (${vf.currentRent}万)</option>`;
    }

    let statusBadge = `<span class="mini-tag ${getAppearanceClass(app.appearance)}">${app.appearanceLabel}</span>`;
    if (app.isInvestigated) {
      const natClass =
        app.trueNature === 'good'
          ? 'tag-good'
          : app.trueNature === 'bad'
          ? 'tag-danger'
          : 'tag-normal';
      const natShort =
        app.trueNature === 'good' ? '善人' : app.trueNature === 'bad' ? '悪人!' : '一般';
      statusBadge += `<span class="mini-tag ${natClass}">本性:${natShort}</span>`;
    }

    const reportHtml = app.isInvestigated
      ? `<div class="secret-report-box" style="padding:4px 8px; font-size:10.5px;">
           <span class="secret-stamp">調査</span>${app.investigationReport}
         </div>`
      : '';

    const card = document.createElement('div');
    card.className = `accordion-card ${isExpanded ? 'is-expanded' : ''}`;

    card.innerHTML = `
      <div class="accordion-header tab-acc-app-toggle" data-applicant-id="${app.id}">
        <div class="tap-card-avatar" style="width:34px; height:34px; font-size:18px;">${avatarEmoji}</div>
        <div class="tap-card-main">
          <div class="tap-card-title">
            <span>${app.name}</span>
            ${statusBadge}
          </div>
          <div class="tap-card-sub">
            <span><strong>${app.desiredTierName}</strong></span>
            <span>${app.occupation}（${app.income}）</span>
          </div>
        </div>
        <span class="accordion-toggle-badge">${isExpanded ? '▲' : '▼ 詳細'}</span>
      </div>
      <div class="accordion-body">
        <div class="accordion-specs-line">
          <span>構成: <strong>${app.familyStructure}</strong></span>
          <span>信憑性: <strong class="text-warning">${app.credibility}%</strong></span>
        </div>
        <div class="speech-bubble" style="padding:4px 8px; font-size:11px;">
          📝 ${app.reviewText}
        </div>
        ${reportHtml}
        <div class="accordion-actions-row">
          <div style="display:flex; align-items:center; gap:5px;">
            ${
              app.isInvestigated
                ? ''
                : `<button type="button" class="btn btn-warning btn-xs btn-tab-app-inv" data-applicant-id="${app.id}" ${
                    state.funds < GAME_CONFIG.INVESTIGATION_COST ? 'disabled' : ''
                  }>🔍 調査 (${GAME_CONFIG.INVESTIGATION_COST}万)</button>`
            }
            <button type="button" class="btn btn-outline btn-xs btn-tab-app-reject" data-applicant-id="${app.id}">👋 見送る</button>
          </div>
          ${
            tierVacantFloors.length > 0
              ? `<div style="display:flex; align-items:center; gap:5px;">
                  <select class="floor-select select-tab-app-floor" data-applicant-id="${app.id}" style="padding:3px 6px; font-size:11px;">${floorOptionsHtml}</select>
                  <button type="button" class="btn btn-primary btn-xs btn-tab-app-accept" data-applicant-id="${app.id}">🚪 契約</button>
                 </div>`
              : `<span class="text-negative" style="font-weight:800;">※空室なし</span>`
          }
        </div>
      </div>
    `;

    const headerEl = card.querySelector('.tab-acc-app-toggle');
    if (headerEl) {
      headerEl.addEventListener('click', () => {
        if (expandedTabApplicantIds.has(app.id)) {
          expandedTabApplicantIds.delete(app.id);
        } else {
          expandedTabApplicantIds.add(app.id);
        }
        onStateChanged();
      });
    }

    const btnInv = card.querySelector('.btn-tab-app-inv');
    if (btnInv) {
      btnInv.addEventListener('click', (e) => {
        e.stopPropagation();
        const res = investigateApplicant(app.id);
        if (res.success) {
          expandedTabApplicantIds.add(app.id);
          onStateChanged();
        }
      });
    }

    const btnRej = card.querySelector('.btn-tab-app-reject');
    if (btnRej) {
      btnRej.addEventListener('click', (e) => {
        e.stopPropagation();
        expandedTabApplicantIds.delete(app.id);
        rejectApplicant(app.id);
        onStateChanged();
      });
    }

    const btnAcc = card.querySelector('.btn-tab-app-accept');
    if (btnAcc) {
      btnAcc.addEventListener('click', (e) => {
        e.stopPropagation();
        const selEl = card.querySelector('.select-tab-app-floor');
        if (!selEl) return;
        expandedTabApplicantIds.delete(app.id);
        acceptApplicant(app.id, Number(selEl.value));
        onStateChanged();
      });
    }

    list.appendChild(card);
  }

  container.appendChild(list);
}

/**
 * タブ2：トラブル対応タブ（折り畳み式アコーディオンカード一覧 ➔ 複数展開して比較・対応可能）
 * @param {HTMLElement} container 描画先コンテナ
 * @param {Function} onStateChanged 状態更新コールバック
 */
function renderTroubleTab(container, onStateChanged) {
  const state = getState();
  const extraInfo = getExtraRepairInfo();

  if (state.troubles.length === 0) {
    const elapsedText =
      state.turn === 1 && extraInfo.turnsSinceLastRepair === 0
        ? '<strong>新築（0期）</strong>'
        : `改修後 <strong>${extraInfo.turnsSinceLastRepair}期</strong> 経過`;
    container.innerHTML = `
      <div class="empty-visual-state">
        <div class="empty-visual-icon">🕊️✨</div>
        <div style="font-size:14px; font-weight:900; color:#fff;">発生中のトラブルはありません</div>
        <p>${elapsedText} ／ 基本トラブル率: <strong class="${extraInfo.currentProbPercent >= 30 ? 'text-warning' : 'text-positive'}">${extraInfo.currentProbPercent}%</strong></p>
        <button type="button" id="btn-empty-extra-repair" class="btn btn-success btn-sm" style="margin-top:4px;">
          🛠️ 臨時改修 (${extraInfo.currentProbPercent}%➔${extraInfo.afterProbPercent}%)
        </button>
      </div>
    `;
    const btnEmptyExtra = container.querySelector('#btn-empty-extra-repair');
    if (btnEmptyExtra) {
      btnEmptyExtra.addEventListener('click', () => {
        showExtraRepairConfirmModal(onStateChanged);
      });
    }
    return;
  }

  const totalTroubles = state.troubles.length;
  const allTrbExpanded =
    totalTroubles > 0 && state.troubles.every((t) => expandedTabTroubleIds.has(t.id));

  const hintBar = document.createElement('div');
  hintBar.className = 'section-hint-bar';
  hintBar.innerHTML = `
    <span class="text-negative">⚡ トラブル（${totalTroubles}件）<small style="color:var(--text-secondary);">発生率${extraInfo.currentProbPercent}%</small></span>
    <div style="display:flex; align-items:center; gap:5px;">
      <button type="button" id="btn-trb-expand-all" class="btn btn-outline btn-xs">
        ${allTrbExpanded ? '📁 全収納' : '📂 全展開'}
      </button>
      <button type="button" id="btn-trouble-extra-repair" class="btn btn-success btn-xs">🛠️ 臨時改修</button>
    </div>
  `;
  container.appendChild(hintBar);

  const btnTrbExpandAll = hintBar.querySelector('#btn-trb-expand-all');
  if (btnTrbExpandAll) {
    btnTrbExpandAll.addEventListener('click', () => {
      if (allTrbExpanded) {
        state.troubles.forEach((t) => expandedTabTroubleIds.delete(t.id));
      } else {
        state.troubles.forEach((t) => expandedTabTroubleIds.add(t.id));
      }
      onStateChanged();
    });
  }

  const btnTrbExtra = hintBar.querySelector('#btn-trouble-extra-repair');
  if (btnTrbExtra) {
    btnTrbExtra.addEventListener('click', () => {
      showExtraRepairConfirmModal(onStateChanged);
    });
  }

  const list = document.createElement('div');
  list.className = 'tap-card-list';

  for (const trb of state.troubles) {
    const isExpanded = expandedTabTroubleIds.has(trb.id);
    const card = document.createElement('div');
    card.className = `accordion-card card-alert ${isExpanded ? 'is-expanded' : ''}`;

    const totalAvail = trb.isEmergencyRepair
      ? state.repairReserve + Math.max(0, state.funds)
      : state.funds;
    const canA = totalAvail >= trb.costA;
    const canB = totalAvail >= trb.costB;

    const badgeTag = trb.isEmergencyRepair
      ? `<span class="mini-tag tag-danger">全館緊急</span>`
      : `<span class="mini-tag tag-danger">${trb.floorNumber}F</span>${
          trb.costMultiplier > 1
            ? `<span class="mini-tag tag-event">×${trb.costMultiplier}</span>`
            : ''
        }`;

    const descSub = trb.isEmergencyRepair
      ? `<div style="font-size:10px; color:var(--color-gold);">※積立金＋手元資金（計${totalAvail.toLocaleString()}万）から支払可</div>`
      : '';

    card.innerHTML = `
      <div class="accordion-header tab-acc-trb-toggle" data-trouble-id="${trb.id}">
        <div class="tap-card-avatar" style="width:34px; height:34px; font-size:18px;">${trb.isEmergencyRepair ? '🛠️' : '🚨'}</div>
        <div class="tap-card-main">
          <div class="tap-card-title">
            ${badgeTag}
            <span>${trb.title}</span>
          </div>
          <div class="tap-card-sub">
            <span>${trb.tenantName}</span>
            <span class="text-warning">A:-${trb.costA.toLocaleString()}万 / B:-${trb.costB.toLocaleString()}万</span>
          </div>
        </div>
        <span class="accordion-toggle-badge">${isExpanded ? '▲' : '▼ 対応'}</span>
      </div>
      <div class="accordion-body">
        <div>${trb.description}</div>
        ${descSub}
        <div class="inline-choice-btns">
          <button type="button" class="inline-choice-btn btn-tab-trb-resolve" data-choice="A" ${!canA ? 'disabled' : ''}>
            <strong class="text-warning">👷 A. 一流業者 (-${trb.costA.toLocaleString()}万)</strong>
            <span style="color:var(--text-secondary);">${trb.isEmergencyRepair ? '全室+15/評判+5/劣化0' : '信頼+15 / 評判+2'}</span>
          </button>
          <button type="button" class="inline-choice-btn btn-tab-trb-resolve" data-choice="B" ${!canB ? 'disabled' : ''}>
            <strong class="text-warning">🔧 B. 格安応急 (-${trb.costB.toLocaleString()}万)</strong>
            <span style="color:var(--text-secondary);">${trb.isEmergencyRepair ? '全室-5 / 劣化半減' : '信頼±0 / 上下階-5'}</span>
          </button>
          <button type="button" class="inline-choice-btn btn-tab-trb-resolve" data-choice="C">
            <strong style="color:var(--text-muted);">🙉 C. 塩対応 (0円)</strong>
            <span class="text-negative">${trb.isEmergencyRepair ? '全室-20/評判-10/悪化' : '信頼-20/上下-15/評判-5'}</span>
          </button>
        </div>
      </div>
    `;

    const headerEl = card.querySelector('.tab-acc-trb-toggle');
    if (headerEl) {
      headerEl.addEventListener('click', () => {
        if (expandedTabTroubleIds.has(trb.id)) {
          expandedTabTroubleIds.delete(trb.id);
        } else {
          expandedTabTroubleIds.add(trb.id);
        }
        onStateChanged();
      });
    }

    card.querySelectorAll('.btn-tab-trb-resolve').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const choiceKey = btn.getAttribute('data-choice');
        expandedTabTroubleIds.delete(trb.id);
        resolveTrouble(trb.id, choiceKey, false);
        onStateChanged();
      });
    });

    list.appendChild(card);
  }

  container.appendChild(list);
}

/**
 * タブ3：財務・積立管理タブ（低層・中層・高層別の固定維持費・税金内訳を表示）
 * @param {HTMLElement} container 描画先コンテナ
 * @param {Function} onStateChanged 状態更新コールバック
 */
function renderFinanceTab(container, onStateChanged) {
  const state = getState();
  const cashflow = calculateExpectedTurnCashflow();
  const mb = cashflow.maintenanceBreakdown;
  const nextRepair = getNextRepairScheduleInfo(state.turn);
  const repairEst = calculateRepairBreakdown(nextRepair.baseCost);
  const reserveShortfall = Math.max(0, repairEst.ownerBurden - state.repairReserve);
  const extraInfo = getExtraRepairInfo();
  const rentPreview = getNextRentPolicyPreview();

  const nextRentBadgeInTable =
    rentPreview.policy === 'up'
      ? ` <small class="text-warning">(次期+5%: +${rentPreview.upDelta}万)</small>`
      : rentPreview.policy === 'down'
      ? ` <small class="text-positive">(次期-5%: ${rentPreview.downDelta}万)</small>`
      : '';

  const nextRentStatusHtml =
    rentPreview.policy === 'up'
      ? `<strong class="text-warning">+5%増額 [次期+${rentPreview.upDelta}万 ⇔ 信頼${GAME_CONFIG.NEXT_RENT_UP_TRUST_DELTA}・評判${GAME_CONFIG.NEXT_RENT_UP_REPUTATION_DELTA}]</strong>`
      : rentPreview.policy === 'down'
      ? `<strong class="text-positive">-5%減額 [次期${rentPreview.downDelta}万 ⇔ 信頼+${GAME_CONFIG.NEXT_RENT_DOWN_TRUST_DELTA}・評判+${GAME_CONFIG.NEXT_RENT_DOWN_REPUTATION_DELTA}]</strong>`
      : `据置 ／ 増:信頼${GAME_CONFIG.NEXT_RENT_UP_TRUST_DELTA}・評判${GAME_CONFIG.NEXT_RENT_UP_REPUTATION_DELTA} ⇔ 減:信頼+${GAME_CONFIG.NEXT_RENT_DOWN_TRUST_DELTA}・評判+${GAME_CONFIG.NEXT_RENT_DOWN_REPUTATION_DELTA}`;

  const wrapper = document.createElement('div');
  wrapper.className = 'finance-dashboard';

  wrapper.innerHTML = `
    <div class="finance-cards-row">
      <div class="finance-box">
        <div>
          <div class="finance-box-title">📊 今期収支予測</div>
          <table class="compact-table">
            <tbody>
              <tr>
                <th>家賃実収入${cashflow.arrearsLoss > 0 ? ` (滞納-${cashflow.arrearsLoss}万)` : ''}${nextRentBadgeInTable}</th>
                <td class="text-positive">+${cashflow.effectiveRent.toLocaleString()}万</td>
              </tr>
              <tr>
                <th>🏠 低層維持 (1-5F)</th>
                <td class="text-negative">-${mb.low.toLocaleString()}万</td>
              </tr>
              <tr>
                <th>💼 中層維持 (6-8F)</th>
                <td class="text-negative">-${mb.mid.toLocaleString()}万</td>
              </tr>
              <tr>
                <th>👑 高層維持 (9-10F)</th>
                <td class="text-negative">-${mb.high.toLocaleString()}万</td>
              </tr>
              <tr>
                <th>🏦 積立費${cashflow.manualReserve > 0 ? ` (自動${cashflow.autoReserve}+即時${cashflow.manualReserve})` : ''}</th>
                <td>-${cashflow.totalReserve.toLocaleString()}万</td>
              </tr>
              <tr>
                <th>🏛️ 税金 (課税所得×${Math.round(GAME_CONFIG.TAX_RATE * 100)}%)</th>
                <td class="text-negative">-${cashflow.taxAmount.toLocaleString()}万</td>
              </tr>
              <tr class="highlight-row">
                <th>期末手元増減</th>
                <td class="${cashflow.netCashflow >= 0 ? 'text-positive' : 'text-negative'}">
                  ${cashflow.netCashflow >= 0 ? '+' : ''}${cashflow.netCashflow.toLocaleString()}万
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="finance-box">
        <div>
          <div class="finance-box-title">🛠️ 修繕計画（定期残${nextRepair.turnsRemaining}T）</div>
          <table class="compact-table">
            <tbody>
              <tr>
                <th>経過 / 基本トラブル率</th>
                <td class="${extraInfo.currentProbPercent >= 30 ? 'text-negative' : 'text-warning'}">
                  ${extraInfo.turnsSinceLastRepair}期 / ${extraInfo.currentProbPercent}%
                </td>
              </tr>
              <tr>
                <th>次回定期 基本費</th>
                <td>${repairEst.baseCost.toLocaleString()}万</td>
              </tr>
              <tr>
                <th>予想住民協力金</th>
                <td class="text-positive">-${repairEst.subsidyAmount.toLocaleString()}万</td>
              </tr>
              <tr class="highlight-row">
                <th>定期修繕 予想負担</th>
                <td class="text-warning">${repairEst.ownerBurden.toLocaleString()}万</td>
              </tr>
              <tr>
                <th>積立過不足</th>
                <td class="${reserveShortfall > 0 ? 'text-negative' : 'text-positive'}">
                  ${reserveShortfall > 0 ? `不足 ${reserveShortfall.toLocaleString()}万` : '充足'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="reserve-action-panel">
      <div class="reserve-controls-line">
        <div style="display:flex; align-items:center; gap:5px;">
          <span style="font-size:11.5px; font-weight:900; color:#fff;">🏦 即時積立:</span>
          <button type="button" class="btn btn-primary btn-xs btn-quick-transfer" data-amount="50" ${state.funds < 50 ? 'disabled' : ''}>+50万</button>
          <button type="button" class="btn btn-primary btn-xs btn-quick-transfer" data-amount="100" ${state.funds < 100 ? 'disabled' : ''}>+100万</button>
          <button type="button" class="btn btn-primary btn-xs btn-quick-transfer" data-amount="300" ${state.funds < 300 ? 'disabled' : ''}>+300万</button>
        </div>
        <div style="display:flex; align-items:center; gap:5px;">
          <input id="input-transfer-amount" type="number" class="input-number" min="10" max="${state.funds}" step="10" value="100">
          <button type="button" id="btn-do-transfer" class="btn btn-warning btn-xs" ${state.funds <= 0 ? 'disabled' : ''}>振替</button>
        </div>
      </div>

      <div class="reserve-controls-line" style="padding-top:4px; border-top:1px solid rgba(255,255,255,0.1);">
        <span style="font-size:11px; color:var(--text-secondary);">
          🔄 <strong>自動積立</strong>（${state.autoReserveAmount}万/期）
        </span>
        <div style="display:flex; align-items:center; gap:5px;">
          <input id="input-auto-reserve" type="number" class="input-number" min="0" max="1000" step="10" value="${state.autoReserveAmount}">
          <button type="button" id="btn-save-auto-reserve" class="btn btn-outline btn-xs">設定</button>
        </div>
      </div>

      <div class="reserve-controls-line" style="padding-top:4px; border-top:1px solid rgba(255,255,255,0.1);">
        <span style="font-size:11px; color:var(--text-secondary);">
          💴 <strong>次期家賃</strong>（${nextRentStatusHtml}）
        </span>
        <div style="display:flex; align-items:center; gap:5px;">
          <button type="button" class="btn ${rentPreview.policy === 'up' ? 'btn-warning' : 'btn-outline'} btn-xs btn-next-rent-policy" data-policy="up">
            ${rentPreview.policy === 'up' ? '✓ ' : ''}📈 5％増額
          </button>
          <button type="button" class="btn ${rentPreview.policy === 'down' ? 'btn-primary' : 'btn-outline'} btn-xs btn-next-rent-policy" data-policy="down">
            ${rentPreview.policy === 'down' ? '✓ ' : ''}📉 5％減額
          </button>
        </div>
      </div>

      <div class="reserve-controls-line" style="padding-top:4px; border-top:1px solid rgba(255,255,255,0.1);">
        <span style="font-size:11px; color:#a7f3d0;">
          🛠️ <strong>臨時改修</strong>（発生率 <strong>${extraInfo.currentProbPercent}%➔${extraInfo.afterProbPercent}%</strong>）
        </span>
        <button type="button" id="btn-open-extra-repair" class="btn btn-success btn-xs" ${extraInfo.alreadyRepairedThisTurn ? 'disabled' : ''}>
          ${extraInfo.alreadyRepairedThisTurn ? (state.turn === 1 ? '✨ 新築・最新' : '✨ 今期実施済') : `🛠️ 実施 (負担${extraInfo.breakdown.ownerBurden.toLocaleString()}万)`}
        </button>
      </div>
    </div>
  `;

  container.appendChild(wrapper);

  wrapper.querySelectorAll('.btn-next-rent-policy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const policy = btn.getAttribute('data-policy');
      setNextRentPolicy(policy);
      onStateChanged();
    });
  });

  wrapper.querySelectorAll('.btn-quick-transfer').forEach((btn) => {
    btn.addEventListener('click', () => {
      const amt = Number(btn.getAttribute('data-amount'));
      transferToRepairReserve(amt);
      onStateChanged();
    });
  });

  const btnTransfer = wrapper.querySelector('#btn-do-transfer');
  if (btnTransfer) {
    btnTransfer.addEventListener('click', () => {
      const inputEl = document.getElementById('input-transfer-amount');
      const amt = Number(inputEl ? inputEl.value : 0);
      const res = transferToRepairReserve(amt);
      if (!res.success) {
        showCustomModal('エラー', `<p>${res.message}</p>`, [
          { label: '閉じる', className: 'btn-primary', onClick: () => closeModal() },
        ]);
      }
      onStateChanged();
    });
  }

  const btnAuto = wrapper.querySelector('#btn-save-auto-reserve');
  if (btnAuto) {
    btnAuto.addEventListener('click', () => {
      const inputEl = document.getElementById('input-auto-reserve');
      const amt = Number(inputEl ? inputEl.value : 0);
      setAutoReserveAmount(amt);
      onStateChanged();
    });
  }

  const btnOpenExtra = wrapper.querySelector('#btn-open-extra-repair');
  if (btnOpenExtra) {
    btnOpenExtra.addEventListener('click', () => {
      showExtraRepairConfirmModal(onStateChanged);
    });
  }
}

/**
 * タブ4：運営ログタブ（ページネーション方式・スクロールなし）
 * @param {HTMLElement} container 描画先コンテナ
 * @param {Function} onStateChanged 状態更新コールバック
 */
function renderLogTab(container, onStateChanged) {
  const state = getState();
  state.hasUnreadLog = false;

  const totalLogs = state.logs.length;
  const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_PER_PAGE));
  if (currentLogPage >= totalPages) {
    currentLogPage = totalPages - 1;
  }

  const startIdx = currentLogPage * LOGS_PER_PAGE;
  const pageLogs = state.logs.slice(startIdx, startIdx + LOGS_PER_PAGE);

  const board = document.createElement('div');
  board.className = 'log-board';

  const pagerBar = document.createElement('div');
  pagerBar.className = 'section-hint-bar';
  pagerBar.innerHTML = `
    <span>📖 運営ログ（全${totalLogs}件）</span>
    <div style="display:flex; align-items:center; gap:6px;">
      <button type="button" id="btn-log-prev" class="btn btn-outline btn-xs" ${currentLogPage <= 0 ? 'disabled' : ''}>◀</button>
      <span>${currentLogPage + 1}/${totalPages}</span>
      <button type="button" id="btn-log-next" class="btn btn-outline btn-xs" ${currentLogPage >= totalPages - 1 ? 'disabled' : ''}>▶</button>
    </div>
  `;
  board.appendChild(pagerBar);

  const listWrap = document.createElement('div');
  listWrap.className = 'log-items-wrap';

  for (const item of pageLogs) {
    const row = document.createElement('div');
    const typeClass =
      item.type === 'good'
        ? 'log-good'
        : item.type === 'warn'
        ? 'log-warn'
        : item.type === 'bad'
        ? 'log-bad'
        : '';

    row.className = `log-card-item ${typeClass}`;
    row.innerHTML = `
      <span class="log-turn-badge">${item.timeLabel}</span>
      <span class="log-cat-badge">[${item.category}]</span>
      <span class="log-text-body" title="${item.message}">${item.message}</span>
    `;
    listWrap.appendChild(row);
  }

  board.appendChild(listWrap);
  container.appendChild(board);

  const btnPrev = pagerBar.querySelector('#btn-log-prev');
  const btnNext = pagerBar.querySelector('#btn-log-next');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (currentLogPage > 0) {
        currentLogPage -= 1;
        onStateChanged();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (currentLogPage < totalPages - 1) {
        currentLogPage += 1;
        onStateChanged();
      }
    });
  }
}

/**
 * アクティブなタブの描画を実行する
 * @param {Function} onStateChanged 状態更新コールバック
 */
export function renderActiveTab(onStateChanged) {
  const state = getState();
  const mainEl = document.getElementById('app-main-view');
  const container = document.getElementById('tab-content-container');
  if (!container) return;

  if (mainEl) {
    mainEl.setAttribute('data-mobile-view', state.activeTab);
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const tabName = btn.getAttribute('data-tab');
    const isActive = tabName === state.activeTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  container.innerHTML = '';

  if (state.activeTab === 'building') {
    renderBuildingEventsTab(container, onStateChanged);
  } else if (state.activeTab === 'screening') {
    renderScreeningTab(container, onStateChanged);
  } else if (state.activeTab === 'trouble') {
    renderTroubleTab(container, onStateChanged);
  } else if (state.activeTab === 'finance') {
    renderFinanceTab(container, onStateChanged);
  } else if (state.activeTab === 'log') {
    renderLogTab(container, onStateChanged);
  }
}
