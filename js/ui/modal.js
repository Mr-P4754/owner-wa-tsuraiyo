/**
 * modal.js
 * タップ詳細確認モーダル（フロア詳細・応募者詳細・トラブル対応・修繕・クリア・ゲームオーバー）の制御
 */

import { GAME_CONFIG, getMaintenanceCostBreakdown } from '../config.js';
import {
  TROUBLE_IMPACT_RULES,
  EMERGENCY_REPAIR_IMPACT_RULES,
} from '../data/troubles.js';
import {
  getState,
  getFloor,
  getTimeInfo,
  getVacantFloors,
  getOccupancyRate,
  setFloorRent,
  saveGame,
} from '../state.js';
import { getCharacterAvatar } from './renderDashboard.js';
import {
  investigateApplicant,
  acceptApplicant,
  rejectApplicant,
  getEvictionPreview,
  executeForceEviction,
} from '../logic/screening.js';
import {
  resolveTrouble,
  resolveRentNegotiation,
} from '../logic/troubleLogic.js';
import {
  getExtraRepairInfo,
  executeExtraRepair,
} from '../logic/repairLogic.js';

/**
 * モーダル要素を取得する
 * @returns {{ overlay: HTMLElement, container: HTMLElement }}
 */
function getModalElements() {
  return {
    overlay: document.getElementById('modal-overlay'),
    container: document.getElementById('modal-container'),
  };
}

/**
 * モーダルを閉じる
 */
export function closeModal() {
  const { overlay, container } = getModalElements();
  if (overlay) overlay.classList.add('hidden');
  if (container) container.innerHTML = '';
}

/**
 * 汎用モーダル表示関数
 * @param {string} titleHtml タイトルHTML
 * @param {string} bodyHtml 本文HTML
 * @param {Array<{ label: string, className: string, onClick: Function }>} actions ボタン配列
 * @param {boolean} allowBackdropClose 背景クリックで閉じるか
 */
export function showCustomModal(titleHtml, bodyHtml, actions = [], allowBackdropClose = true) {
  const { overlay, container } = getModalElements();
  if (!overlay || !container) return;

  container.innerHTML = `
    <div class="modal-title">${titleHtml}</div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-actions" id="modal-actions-wrap"></div>
  `;

  const actionsWrap = container.querySelector('#modal-actions-wrap');
  for (const act of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${act.className || 'btn-primary'}`;
    btn.textContent = act.label;
    btn.addEventListener('click', () => {
      if (act.onClick) {
        act.onClick();
      } else {
        closeModal();
      }
    });
    actionsWrap.appendChild(btn);
  }

  overlay.onclick = (e) => {
    if (allowBackdropClose && e.target === overlay) {
      closeModal();
    }
  };

  overlay.classList.remove('hidden');
}

/** モーダル内の空室応募者リストおよび住民トラブルリストの折り畳み展開状態 */
const expandedModalApplicantIds = new Set();
const expandedModalTroubleIds = new Set();

/**
 * 見た目カテゴリのバッジクラスを返す
 * @param {string} appearance 見た目ID
 * @returns {string} CSSクラス名
 */
function getAppearanceClassForModal(appearance) {
  if (appearance === 'good') return 'tag-good';
  if (appearance === 'suspicious') return 'tag-suspicious';
  return 'tag-normal';
}

/**
 * 強制退去の実行前に「本当に退去させますか？」の確認モーダルを表示する
 * @param {object} floor 対象フロアオブジェクト
 * @param {Function} onStateChanged 状態更新コールバック
 */
export function showEvictionConfirmModal(floor, onStateChanged) {
  if (!floor || !floor.tenant) return;
  const state = getState();
  const tenant = floor.tenant;
  const preview = getEvictionPreview(floor.floorNumber);
  const canAffordStandard = state.funds >= preview.standardEvictionCost;

  const bodyHtml = `
    <div class="speech-bubble" style="border-left-color: var(--color-rose); font-size:13px;">
      <strong>⚠️ ${floor.floorNumber}階「${tenant.name}」を本当に退去させますか？</strong>
    </div>
    <table class="compact-table">
      <tbody>
        <tr>
          <th>契約家賃</th>
          <td>${floor.currentRent.toLocaleString()}万円 / 期</td>
        </tr>
        <tr class="highlight-row">
          <th>💰 通常立ち退き料（3期分）</th>
          <td class="text-warning">${preview.standardEvictionCost.toLocaleString()}万円</td>
        </tr>
        <tr>
          <th>😈 悪人・反社の場合（5期分）</th>
          <td class="text-negative">${preview.badEvictionCost.toLocaleString()}万円</td>
        </tr>
        <tr>
          <th>手元資金</th>
          <td class="${canAffordStandard ? 'text-positive' : 'text-negative'}">${state.funds.toLocaleString()}万円</td>
        </tr>
      </tbody>
    </table>
    <div style="font-size:11px; color:var(--text-secondary);">
      ※本性が悪人・反社で5期分を支払えない場合、居座りトラブルとなり近隣信頼と評判が低下します。
    </div>
  `;

  const actions = [
    {
      label: `◀ 戻る`,
      className: 'btn-outline',
      onClick: () => {
        showFloorDetailModal(floor, onStateChanged);
      },
    },
    {
      label: `🚨 本当に退去させる`,
      className: 'btn-danger',
      onClick: () => {
        closeModal();
        const res = executeForceEviction(floor.floorNumber);
        onStateChanged();
        if (!res.success || res.isBadTenant) {
          showCustomModal(
            res.success ? '💥 悪質住民の退去完了' : '🚨 居座りトラブル発生',
            `<p>${res.message}</p>`,
            [{ label: '確認', className: 'btn-primary', onClick: () => closeModal() }]
          );
        }
      },
    },
  ];

  showCustomModal(`🚨 強制退去の確認（${floor.floorNumber}F）`, bodyHtml, actions, true);
}

/**
 * フロア（部屋）をタップした際の詳細＆操作モーダルを表示する
 * ・空室の場合：家賃変更UI ＋ 当該階層の入居希望者リスト（縦スクロール＆折り畳み式比較）を表示
 * ・入居中の場合：住民情報詳細 ＋ 発生中のトラブル一覧（縦スクロール＆折り畳み式比較）を表示
 * @param {object} floor フロアオブジェクト
 * @param {Function} onStateChanged 状態更新コールバック
 */
export function showFloorDetailModal(floor, onStateChanged) {
  const state = getState();
  const recentEvent = floor.recentEvent;
  if (floor.recentEvent) {
    floor.recentEvent = null;
    saveGame();
    onStateChanged();
  }

  const eventBannerHtml = recentEvent
    ? `<div class="secret-report-box" style="margin-bottom:4px;"><strong>${recentEvent.label}：</strong>${recentEvent.detail}</div>`
    : '';

  // 1. 空室の場合：募集家賃の変更UI ＋ 入居希望者リスト（縦スクロール＆折り畳み式比較カード）を表示
  if (!floor.tenant) {
    const minRent = Math.round(floor.standardRent * GAME_CONFIG.MIN_RENT_RATIO);
    const maxRent = Math.round(floor.standardRent * GAME_CONFIG.MAX_RENT_RATIO);
    const matchingApplicants = state.applicants.filter((a) => a.desiredTier === floor.tier);

    const allExpanded =
      matchingApplicants.length > 0 &&
      matchingApplicants.every((a) => expandedModalApplicantIds.has(a.id));

    let applicantListHtml = '';
    if (matchingApplicants.length === 0) {
      applicantListHtml = `
        <div class="speech-bubble" style="text-align:center; color:var(--text-secondary);">
          現在 <strong>${floor.tierName}</strong> の審査待ち応募者はいません。
        </div>
      `;
    } else {
      const cardsHtml = matchingApplicants
        .map((app) => {
          const isExpanded = expandedModalApplicantIds.has(app.id);
          const avatarEmoji = getCharacterAvatar(app, app.desiredTier);
          let statusBadge = `<span class="mini-tag ${getAppearanceClassForModal(app.appearance)}">${app.appearanceLabel}</span>`;
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

          return `
            <div class="accordion-card ${isExpanded ? 'is-expanded' : ''}" data-acc-app-card="${app.id}">
              <div class="accordion-header modal-acc-app-toggle" data-applicant-id="${app.id}">
                <div class="tap-card-avatar" style="width:32px; height:32px; font-size:17px;">${avatarEmoji}</div>
                <div class="tap-card-main">
                  <div class="tap-card-title" style="font-size:12px;">
                    <span>${app.name}</span>
                    ${statusBadge}
                  </div>
                  <div class="tap-card-sub" style="font-size:10.5px;">
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
                        : `<button type="button" class="btn btn-warning btn-xs btn-acc-investigate" data-applicant-id="${app.id}" ${
                            state.funds < GAME_CONFIG.INVESTIGATION_COST ? 'disabled' : ''
                          }>🔍 調査 (${GAME_CONFIG.INVESTIGATION_COST}万)</button>`
                    }
                    <button type="button" class="btn btn-outline btn-xs btn-acc-reject" data-applicant-id="${app.id}">👋 見送る</button>
                  </div>
                  <button type="button" class="btn btn-primary btn-xs btn-acc-accept" data-applicant-id="${app.id}">
                    🚪 ${floor.floorNumber}F(${floor.currentRent}万)で契約
                  </button>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      applicantListHtml = `
        <div class="section-hint-bar" style="margin-top:4px;">
          <span>📋 入居希望者（${matchingApplicants.length}組）</span>
          <button type="button" id="btn-modal-app-expand-all" class="btn btn-outline btn-xs">
            ${allExpanded ? '📁 全収納' : '📂 全展開'}
          </button>
        </div>
        <div class="tap-card-list" style="max-height:320px;">
          ${cardsHtml}
        </div>
      `;
    }

    const bodyHtml = `
      ${eventBannerHtml}
      <div class="dossier-specs">
        <div class="spec-item">
          <span class="spec-label">階層 / 対象層</span>
          <span class="spec-value">${floor.tierName}（${floor.targetName}）</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">適正家賃 / 維持費</span>
          <span class="spec-value"><span class="text-warning">${floor.standardRent}万</span> ／ <span class="text-negative">-${floor.maintenanceCost}万</span></span>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:5px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
            <label for="modal-rent-input" style="font-weight:800; font-size:11.5px;">募集家賃(万):</label>
            <input id="modal-rent-input" type="number" class="input-number" min="${minRent}" max="${maxRent}" step="1" value="${floor.currentRent}">
            <button type="button" class="btn btn-outline btn-xs" data-preset="${minRent}">50%</button>
            <button type="button" class="btn btn-outline btn-xs" data-preset="${Math.round(floor.standardRent * 0.85)}">85%</button>
            <button type="button" class="btn btn-outline btn-xs" data-preset="${floor.standardRent}">適正</button>
            <button type="button" class="btn btn-outline btn-xs" data-preset="${Math.round(floor.standardRent * 1.15)}">115%</button>
          </div>
          <button type="button" id="btn-inline-save-rent" class="btn btn-primary btn-xs">家賃変更</button>
        </div>
        <div id="modal-rent-hint" style="font-size:11px;"></div>
      </div>
      ${applicantListHtml}
    `;

    showCustomModal(
      `🚪 ${floor.floorNumber}階 空室（${floor.tierName}）`,
      bodyHtml,
      [{ label: '閉じる', className: 'btn-outline', onClick: () => closeModal() }],
      true
    );

    const inputEl = document.getElementById('modal-rent-input');
    const hintEl = document.getElementById('modal-rent-hint');
    const updateHint = () => {
      if (!inputEl || !hintEl) return;
      const val = Number(inputEl.value);
      const ratio = val / floor.standardRent;
      if (ratio > 1.05) {
        hintEl.innerHTML = `<span class="text-warning">📈 高家賃 (${Math.round(ratio * 100)}%)：</span>応募確率が低下します。`;
      } else if (ratio < 0.95) {
        hintEl.innerHTML = `<span class="text-negative">⚠️ 低家賃 (${Math.round(ratio * 100)}%)：</span>悪質住民リスクが上昇します。`;
      } else {
        hintEl.innerHTML = `<span class="text-positive">✅ 適正 (${Math.round(ratio * 100)}%)：</span>標準的な募集条件です。`;
      }
    };
    if (inputEl) {
      inputEl.addEventListener('input', updateHint);
      updateHint();
    }
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (inputEl) {
          inputEl.value = btn.getAttribute('data-preset');
          updateHint();
        }
      });
    });

    const btnSaveRent = document.getElementById('btn-inline-save-rent');
    if (btnSaveRent) {
      btnSaveRent.addEventListener('click', () => {
        const val = Number(inputEl ? inputEl.value : floor.currentRent);
        if (setFloorRent(floor.floorNumber, val)) {
          saveGame();
          onStateChanged();
          showFloorDetailModal(floor, onStateChanged);
        }
      });
    }

    // 折り畳みヘッダーの開閉
    document.querySelectorAll('.modal-acc-app-toggle').forEach((headerEl) => {
      headerEl.addEventListener('click', () => {
        const appId = headerEl.getAttribute('data-applicant-id');
        if (!appId) return;
        if (expandedModalApplicantIds.has(appId)) {
          expandedModalApplicantIds.delete(appId);
        } else {
          expandedModalApplicantIds.add(appId);
        }
        showFloorDetailModal(floor, onStateChanged);
      });
    });

    // 全展開 / 全折り畳みボタン
    const btnExpandAll = document.getElementById('btn-modal-app-expand-all');
    if (btnExpandAll) {
      btnExpandAll.addEventListener('click', () => {
        if (allExpanded) {
          matchingApplicants.forEach((a) => expandedModalApplicantIds.delete(a.id));
        } else {
          matchingApplicants.forEach((a) => expandedModalApplicantIds.add(a.id));
        }
        showFloorDetailModal(floor, onStateChanged);
      });
    }

    // 興信所調査（その場で結果を開示し展開状態を維持）
    document.querySelectorAll('.btn-acc-investigate').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const appId = btn.getAttribute('data-applicant-id');
        if (!appId) return;
        const res = investigateApplicant(appId);
        if (res.success) {
          expandedModalApplicantIds.add(appId);
          onStateChanged();
          showFloorDetailModal(floor, onStateChanged);
        }
      });
    });

    // 見送る（その場でリストを更新）
    document.querySelectorAll('.btn-acc-reject').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const appId = btn.getAttribute('data-applicant-id');
        if (!appId) return;
        expandedModalApplicantIds.delete(appId);
        rejectApplicant(appId);
        onStateChanged();
        showFloorDetailModal(floor, onStateChanged);
      });
    });

    // この階と契約する
    document.querySelectorAll('.btn-acc-accept').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const appId = btn.getAttribute('data-applicant-id');
        if (!appId) return;
        expandedModalApplicantIds.delete(appId);
        acceptApplicant(appId, floor.floorNumber);
        closeModal();
        onStateChanged();
      });
    });
    return;
  }

  // 2. 入居中の場合：住民プロフィール・発生中トラブル一覧（縦スクロール＆折り畳み式比較）・家賃交渉・強制退去を表示
  const tenant = floor.tenant;
  const yearsStayed = (tenant.occupiedTurns / GAME_CONFIG.TURNS_PER_YEAR).toFixed(1);
  const natureText = tenant.isNatureRevealed
    ? GAME_CONFIG.TRUE_NATURE_LABELS[tenant.trueNature]
    : '未判明';

  // 当該フロアで発生しているトラブル（および全館緊急大規模改修）を抽出
  const floorTroubles = state.troubles.filter(
    (t) => (!t.isEmergencyRepair && t.floorNumber === floor.floorNumber) || t.isEmergencyRepair
  );
  const allTrbExpanded =
    floorTroubles.length > 0 &&
    floorTroubles.every((t) => expandedModalTroubleIds.has(t.id));

  let troublesHtml = '';
  if (floorTroubles.length > 0) {
    const trbCards = floorTroubles
      .map((trb) => {
        const isExpanded = expandedModalTroubleIds.has(trb.id);
        const badgeText = trb.isEmergencyRepair
          ? '全館緊急'
          : `×${trb.costMultiplier || 1}`;

        const totalAvail = trb.isEmergencyRepair
          ? state.repairReserve + Math.max(0, state.funds)
          : state.funds;
        const canA = totalAvail >= trb.costA;
        const canB = totalAvail >= trb.costB;

        const descSub = trb.isEmergencyRepair
          ? `<div style="font-size:10px; color:var(--color-gold);">※積立金＋手元資金（計${totalAvail.toLocaleString()}万）から支払可</div>`
          : '';

        return `
          <div class="accordion-card card-alert ${isExpanded ? 'is-expanded' : ''}">
            <div class="accordion-header modal-acc-trb-toggle" data-trouble-id="${trb.id}">
              <div class="tap-card-avatar" style="width:32px; height:32px; font-size:17px;">${trb.isEmergencyRepair ? '🛠️' : '🚨'}</div>
              <div class="tap-card-main">
                <div class="tap-card-title" style="font-size:12px;">
                  <span class="mini-tag tag-danger">${badgeText}</span>
                  <span>${trb.title}</span>
                </div>
                <div class="tap-card-sub" style="font-size:10.5px;">
                  <span class="text-warning">A:-${trb.costA.toLocaleString()}万 / B:-${trb.costB.toLocaleString()}万</span>
                </div>
              </div>
              <span class="accordion-toggle-badge">${isExpanded ? '▲' : '▼ 対応'}</span>
            </div>
            <div class="accordion-body">
              <div>${trb.description}</div>
              ${descSub}
              <div class="inline-choice-btns">
                <button type="button" class="inline-choice-btn btn-acc-trb-resolve" data-trouble-id="${trb.id}" data-choice="A" ${!canA ? 'disabled' : ''}>
                  <strong class="text-warning">👷 A. 一流業者 (-${trb.costA.toLocaleString()}万)</strong>
                  <span style="color:var(--text-secondary);">${trb.isEmergencyRepair ? '全室+15/評判+5/劣化0' : '信頼+15 / 評判+2'}</span>
                </button>
                <button type="button" class="inline-choice-btn btn-acc-trb-resolve" data-trouble-id="${trb.id}" data-choice="B" ${!canB ? 'disabled' : ''}>
                  <strong class="text-warning">🔧 B. 格安応急 (-${trb.costB.toLocaleString()}万)</strong>
                  <span style="color:var(--text-secondary);">${trb.isEmergencyRepair ? '全室-5 / 劣化半減' : '信頼±0 / 上下階-5'}</span>
                </button>
                <button type="button" class="inline-choice-btn btn-acc-trb-resolve" data-trouble-id="${trb.id}" data-choice="C">
                  <strong style="color:var(--text-muted);">🙉 C. 塩対応 (0円)</strong>
                  <span class="text-negative">${trb.isEmergencyRepair ? '全室-20/評判-10/悪化' : '信頼-20/上下-15/評判-5'}</span>
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    troublesHtml = `
      <div style="display:flex; flex-direction:column; gap:5px;">
        <div class="section-hint-bar" style="border-color:var(--color-rose);">
          <span class="text-negative">⚡ トラブル（${floorTroubles.length}件）</span>
          <button type="button" id="btn-modal-trb-expand-all" class="btn btn-outline btn-xs">
            ${allTrbExpanded ? '📁 全収納' : '📂 全展開'}
          </button>
        </div>
        <div class="tap-card-list" style="max-height:240px;">
          ${trbCards}
        </div>
      </div>
    `;
  }

  let negHtml = '';
  if (tenant.pendingRentNegotiation) {
    const neg = tenant.pendingRentNegotiation;
    const isUp = neg.type === 'up';
    negHtml = `
      <div class="secret-report-box" style="display:flex; flex-direction:column; gap:6px;">
        <div>
          <strong>${isUp ? '📈 家賃UP提案' : '📉 家賃減額要請'}</strong>：
          <strong>${neg.currentRent}万円</strong> ➔ <strong class="${isUp ? 'text-positive' : 'text-warning'}">${neg.proposedRent}万円</strong>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" id="btn-modal-neg-accept" class="btn ${isUp ? 'btn-success' : 'btn-warning'} btn-xs">
            ${isUp ? `${neg.proposedRent}万へ値上げ` : `${neg.proposedRent}万へ減額 (信頼+10)`}
          </button>
          <button type="button" id="btn-modal-neg-keep" class="btn btn-outline btn-xs">
            ${isUp ? '据え置く (信頼+10)' : '維持する (信頼-15)'}
          </button>
        </div>
      </div>
    `;
  }

  const bodyHtml = `
    ${eventBannerHtml}
    ${troublesHtml}
    ${negHtml}
    <div class="dossier-specs">
      <div class="spec-item">
        <span class="spec-label">契約家賃 / 維持費</span>
        <span class="spec-value"><span class="text-warning">${tenant.isInArrears ? '0万(滞納)' : `${floor.currentRent}万`}</span> ／ <span class="text-negative">-${floor.maintenanceCost}万</span></span>
      </div>
      <div class="spec-item">
        <span class="spec-label">信頼度 / 入居期間</span>
        <span class="spec-value">❤️ ${tenant.trust} ／ ${yearsStayed}年 ${tenant.isAged ? '(高齢)' : ''}</span>
      </div>
      <div class="spec-item">
        <span class="spec-label">職業 / 規模</span>
        <span class="spec-value">${tenant.occupation}（${tenant.income}）</span>
      </div>
      <div class="spec-item">
        <span class="spec-label">構成 / 見た目</span>
        <span class="spec-value">${tenant.familyStructure} ／ ${tenant.appearanceLabel}</span>
      </div>
      <div class="spec-item" style="grid-column: span 2;">
        <span class="spec-label">本性</span>
        <span class="spec-value ${tenant.isNatureRevealed && tenant.trueNature === 'bad' ? 'text-negative' : ''}">${natureText}</span>
      </div>
    </div>
  `;

  showCustomModal(
    `🏢 ${floor.floorNumber}階「${tenant.name}」`,
    bodyHtml,
    [
      {
        label: '🚨 強制退去させる',
        className: 'btn-danger',
        onClick: () => {
          showEvictionConfirmModal(floor, onStateChanged);
        },
      },
      { label: '閉じる', className: 'btn-outline', onClick: () => closeModal() },
    ],
    true
  );

  // トラブル折り畳みヘッダーの開閉
  document.querySelectorAll('.modal-acc-trb-toggle').forEach((headerEl) => {
    headerEl.addEventListener('click', () => {
      const trbId = headerEl.getAttribute('data-trouble-id');
      if (!trbId) return;
      if (expandedModalTroubleIds.has(trbId)) {
        expandedModalTroubleIds.delete(trbId);
      } else {
        expandedModalTroubleIds.add(trbId);
      }
      showFloorDetailModal(floor, onStateChanged);
    });
  });

  // トラブル全展開 / 全折り畳みボタン
  const btnTrbExpandAll = document.getElementById('btn-modal-trb-expand-all');
  if (btnTrbExpandAll) {
    btnTrbExpandAll.addEventListener('click', () => {
      if (allTrbExpanded) {
        floorTroubles.forEach((t) => expandedModalTroubleIds.delete(t.id));
      } else {
        floorTroubles.forEach((t) => expandedModalTroubleIds.add(t.id));
      }
      showFloorDetailModal(floor, onStateChanged);
    });
  }

  // トラブルのその場での対応（A / B / C）
  document.querySelectorAll('.btn-acc-trb-resolve').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trbId = btn.getAttribute('data-trouble-id');
      const choiceKey = btn.getAttribute('data-choice');
      if (!trbId || !choiceKey) return;
      expandedModalTroubleIds.delete(trbId);
      resolveTrouble(trbId, choiceKey, false);
      onStateChanged();
      showFloorDetailModal(floor, onStateChanged);
    });
  });

  const btnNegAccept = document.getElementById('btn-modal-neg-accept');
  const btnNegKeep = document.getElementById('btn-modal-neg-keep');
  if (btnNegAccept) {
    btnNegAccept.addEventListener('click', () => {
      resolveRentNegotiation(floor.floorNumber, 'accept');
      closeModal();
      onStateChanged();
    });
  }
  if (btnNegKeep) {
    btnNegKeep.addEventListener('click', () => {
      resolveRentNegotiation(floor.floorNumber, 'keep');
      closeModal();
      onStateChanged();
    });
  }
}

/**
 * 応募者カードをタップした際の詳細審査＆契約モーダルを表示する
 * @param {string} applicantId 応募者ID
 * @param {Function} onStateChanged 状態更新コールバック
 * @param {number | null} fromFloorNumber 空室フロア詳細から遷移してきた場合の階数
 */
export function showApplicantDetailModal(applicantId, onStateChanged, fromFloorNumber = null) {
  const state = getState();
  const app = state.applicants.find((a) => a.id === applicantId);
  if (!app) return;

  const vacantFloors = getVacantFloors()
    .filter((f) => f.tier === app.desiredTier)
    .sort((a, b) => a.floorNumber - b.floorNumber);

  const defaultSelectedFloor = fromFloorNumber || app.preferredFloorNumber;
  let floorOptionsHtml = '';
  for (const vf of vacantFloors) {
    const selected = vf.floorNumber === defaultSelectedFloor ? 'selected' : '';
    floorOptionsHtml += `<option value="${vf.floorNumber}" ${selected}>${vf.floorNumber}F (家賃 ${vf.currentRent}万)</option>`;
  }

  let reportHtml = '';
  if (app.isInvestigated) {
    const natureLabel = GAME_CONFIG.TRUE_NATURE_LABELS[app.trueNature];
    const natureColor =
      app.trueNature === 'good'
        ? 'text-positive'
        : app.trueNature === 'bad'
        ? 'text-negative'
        : '';
    reportHtml = `
      <div class="secret-report-box">
        <div><span class="secret-stamp">調査済</span>${app.investigationReport}</div>
        <div style="margin-top:3px; font-weight:900;">
          判明した本性: <span class="${natureColor}">【${natureLabel}】</span>
        </div>
      </div>
    `;
  }

  const bodyHtml = `
    <div class="dossier-specs">
      <div class="spec-item">
        <span class="spec-label">見た目 / 寸評信憑性</span>
        <span class="spec-value">${app.appearanceLabel}（信憑性 ${app.credibility}%）</span>
      </div>
      <div class="spec-item">
        <span class="spec-label">希望階層</span>
        <span class="spec-value text-warning">${app.desiredTierName}（空室${vacantFloors.length}）</span>
      </div>
      <div class="spec-item">
        <span class="spec-label">職業・事業内容</span>
        <span class="spec-value">${app.occupation}</span>
      </div>
      <div class="spec-item">
        <span class="spec-label">年収 / 構成</span>
        <span class="spec-value">${app.income} ／ ${app.familyStructure}</span>
      </div>
    </div>

    <div class="speech-bubble">
      <strong>📝 事前寸評：</strong>「${app.reviewText}」
    </div>

    ${reportHtml}

    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:4px; flex-wrap:wrap;">
      ${
        app.isInvestigated
          ? `<span class="mini-tag tag-good">✓ 調査完了</span>`
          : `<button type="button" id="btn-modal-investigate" class="btn btn-warning btn-sm" ${
              state.funds < GAME_CONFIG.INVESTIGATION_COST ? 'disabled' : ''
            }>
              🔍 興信所で調査 (${GAME_CONFIG.INVESTIGATION_COST}万)
            </button>`
      }
      ${
        vacantFloors.length > 0
          ? `<div style="display:flex; align-items:center; gap:6px;">
              <select id="modal-select-floor" class="floor-select">${floorOptionsHtml}</select>
              <button type="button" id="btn-modal-accept" class="btn btn-primary btn-sm">🚪 契約する</button>
             </div>`
          : `<span class="text-negative" style="font-weight:800;">※希望階層に空室なし</span>`
      }
    </div>
  `;

  const actions = [];
  if (fromFloorNumber) {
    actions.push({
      label: `◀ ${fromFloorNumber}F 空室へ戻る`,
      className: 'btn-outline',
      onClick: () => {
        const targetFloor = getFloor(fromFloorNumber);
        if (targetFloor) {
          showFloorDetailModal(targetFloor, onStateChanged);
        } else {
          closeModal();
        }
      },
    });
  }
  actions.push({
    label: '👋 見送る',
    className: 'btn-outline',
    onClick: () => {
      rejectApplicant(app.id);
      onStateChanged();
      if (fromFloorNumber) {
        const targetFloor = getFloor(fromFloorNumber);
        if (targetFloor && !targetFloor.tenant) {
          showFloorDetailModal(targetFloor, onStateChanged);
          return;
        }
      }
      closeModal();
    },
  });
  actions.push({ label: '閉じる', className: 'btn-outline', onClick: () => closeModal() });

  showCustomModal(`📋 入居審査：${app.name}`, bodyHtml, actions, true);

  const btnInv = document.getElementById('btn-modal-investigate');
  if (btnInv) {
    btnInv.addEventListener('click', () => {
      const res = investigateApplicant(app.id);
      onStateChanged();
      if (res.success) {
        showApplicantDetailModal(app.id, onStateChanged, fromFloorNumber);
      }
    });
  }

  const btnAcc = document.getElementById('btn-modal-accept');
  if (btnAcc) {
    btnAcc.addEventListener('click', () => {
      const sel = document.getElementById('modal-select-floor');
      if (!sel) return;
      const floorNum = Number(sel.value);
      acceptApplicant(app.id, floorNum);
      closeModal();
      onStateChanged();
    });
  }
}

/**
 * トラブルカードをタップした際の対応選択モーダルを表示する
 * @param {string} troubleId トラブルID
 * @param {Function} onStateChanged 状態更新コールバック
 * @param {number | null} fromFloorNumber 入居者詳細モーダルから遷移してきた場合の階数
 */
export function showTroubleDetailModal(troubleId, onStateChanged, fromFloorNumber = null) {
  const state = getState();
  const trb = state.troubles.find((t) => t.id === troubleId);
  if (!trb) return;

  const modalActions = [];
  if (fromFloorNumber) {
    modalActions.push({
      label: `◀ ${fromFloorNumber}F 詳細へ戻る`,
      className: 'btn-outline',
      onClick: () => {
        const targetFloor = getFloor(fromFloorNumber);
        if (targetFloor) {
          showFloorDetailModal(targetFloor, onStateChanged);
        } else {
          closeModal();
        }
      },
    });
  }
  modalActions.push({ label: '閉じる', className: 'btn-outline', onClick: () => closeModal() });

  const handleAfterTroubleResolved = () => {
    onStateChanged();
    if (fromFloorNumber) {
      const targetFloor = getFloor(fromFloorNumber);
      if (targetFloor && targetFloor.tenant) {
        showFloorDetailModal(targetFloor, onStateChanged);
        return;
      }
    }
    closeModal();
  };

  // --- 緊急大規模改修トラブル（全館・3パターン選択）の場合 ---
  if (trb.isEmergencyRepair) {
    const totalAvailable = state.repairReserve + Math.max(0, state.funds);
    const canAffordA = totalAvailable >= trb.costA;
    const canAffordB = totalAvailable >= trb.costB;

    const bodyHtml = `
      <div class="speech-bubble" style="border-left-color: var(--color-rose);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:2px;">
          <strong>🚨 ビル全館（${trb.tenantName}）</strong>
          <span class="mini-tag tag-danger">大規模改修ベース費：${trb.baseRepairCost.toLocaleString()}万</span>
        </div>
        <div>${trb.description}</div>
        <div style="margin-top:4px; font-size:11px; color:var(--color-gold);">
          💡 <strong>修繕積立金(${state.repairReserve.toLocaleString()}万) ＋ 手元資金(${state.funds.toLocaleString()}万) ＝ 計${totalAvailable.toLocaleString()}万</strong> から支払えます。
        </div>
      </div>

      <div class="trouble-choices-grid">
        <button type="button" class="choice-card-btn btn-modal-trb-choice" data-choice="A" ${
          !canAffordA ? 'disabled' : ''
        }>
          <div class="choice-emoji">🏗️✨</div>
          <div class="choice-info">
            <span class="choice-name">${EMERGENCY_REPAIR_IMPACT_RULES.A.label}</span>
            <span class="choice-desc">${EMERGENCY_REPAIR_IMPACT_RULES.A.effectSummary}</span>
          </div>
          <span class="choice-price-badge">-${trb.costA.toLocaleString()}万</span>
        </button>

        <button type="button" class="choice-card-btn btn-modal-trb-choice" data-choice="B" ${
          !canAffordB ? 'disabled' : ''
        }>
          <div class="choice-emoji">🛠️💦</div>
          <div class="choice-info">
            <span class="choice-name">${EMERGENCY_REPAIR_IMPACT_RULES.B.label}</span>
            <span class="choice-desc">${EMERGENCY_REPAIR_IMPACT_RULES.B.effectSummary}</span>
          </div>
          <span class="choice-price-badge">-${trb.costB.toLocaleString()}万</span>
        </button>

        <button type="button" class="choice-card-btn btn-modal-trb-choice" data-choice="C">
          <div class="choice-emoji">🙉💥</div>
          <div class="choice-info">
            <span class="choice-name">${EMERGENCY_REPAIR_IMPACT_RULES.C.label}</span>
            <span class="choice-desc">${EMERGENCY_REPAIR_IMPACT_RULES.C.effectSummary}</span>
          </div>
          <span class="choice-price-badge" style="color:var(--text-muted); border-color:#475569;">0円</span>
        </button>
      </div>
    `;

    showCustomModal(`🚨 ${trb.title}`, bodyHtml, modalActions, true);

    document.querySelectorAll('.btn-modal-trb-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choiceKey = btn.getAttribute('data-choice');
        resolveTrouble(trb.id, choiceKey, false);
        handleAfterTroubleResolved();
      });
    });
    return;
  }

  // --- 通常の各フロアトラブルの場合 ---
  const canAffordA = state.funds >= trb.costA;
  const canAffordB = state.funds >= trb.costB;
  const multLabel =
    trb.costMultiplier && trb.costMultiplier > 1
      ? `<span class="mini-tag tag-danger">${trb.tierName}倍率 ×${trb.costMultiplier}</span>`
      : `<span class="mini-tag tag-normal">${trb.tierName || '低層階'}基準 ×1.0</span>`;

  const bodyHtml = `
    <div class="speech-bubble" style="border-left-color: var(--color-rose);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:2px;">
        <strong>${trb.floorNumber}階（${trb.tenantName}）</strong>
        ${multLabel}
      </div>
      <div>${trb.description}</div>
    </div>

    <div class="trouble-choices-grid">
      <button type="button" class="choice-card-btn btn-modal-trb-choice" data-choice="A" ${
        !canAffordA ? 'disabled' : ''
      }>
        <div class="choice-emoji">👷✨</div>
        <div class="choice-info">
          <span class="choice-name">${TROUBLE_IMPACT_RULES.A.label}</span>
          <span class="choice-desc">信頼 <strong class="text-positive">+15</strong> ／ 上下階影響なし ／ 評判 <strong class="text-positive">+2</strong></span>
        </div>
        <span class="choice-price-badge">-${trb.costA}万</span>
      </button>

      <button type="button" class="choice-card-btn btn-modal-trb-choice" data-choice="B" ${
        !canAffordB ? 'disabled' : ''
      }>
        <div class="choice-emoji">🔧💦</div>
        <div class="choice-info">
          <span class="choice-name">${TROUBLE_IMPACT_RULES.B.label}</span>
          <span class="choice-desc">信頼 ±0 ／ 上下階信頼 <strong class="text-warning">-5</strong> ／ 評判 ±0</span>
        </div>
        <span class="choice-price-badge">-${trb.costB}万</span>
      </button>

      <button type="button" class="choice-card-btn btn-modal-trb-choice" data-choice="C">
        <div class="choice-emoji">🙉💥</div>
        <div class="choice-info">
          <span class="choice-name">${TROUBLE_IMPACT_RULES.C.label}</span>
          <span class="choice-desc">信頼 <strong class="text-negative">-20</strong> ／ 上下階信頼 <strong class="text-negative">-15</strong> ／ 評判 <strong class="text-negative">-5</strong></span>
        </div>
        <span class="choice-price-badge" style="color:var(--text-muted); border-color:#475569;">0円</span>
      </button>
    </div>
  `;

  showCustomModal(`⚡ ${trb.floorNumber}F トラブル：${trb.title}`, bodyHtml, modalActions, true);

  document.querySelectorAll('.btn-modal-trb-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const choiceKey = btn.getAttribute('data-choice');
      resolveTrouble(trb.id, choiceKey, false);
      handleAfterTroubleResolved();
    });
  });
}

/**
 * 臨時大規模改修の確認・実行モーダルを表示する
 * @param {Function} onStateChanged 状態更新コールバック
 */
export function showExtraRepairConfirmModal(onStateChanged) {
  const state = getState();
  const info = getExtraRepairInfo();
  const b = info.breakdown;

  const statusBanner = info.alreadyRepairedThisTurn
    ? `<div class="speech-bubble" style="border-left-color: var(--color-emerald);">✨ ${state.turn === 1 ? '新築のため設備は最新状態です' : '今期すでに大規模改修を実施済みです'}（基本トラブル率: 初期値 <strong>${info.afterProbPercent}%</strong>）。</div>`
    : `<div class="speech-bubble" style="border-left-color: var(--color-amber);">
        🔧 前回改修から <strong>${info.turnsSinceLastRepair}期</strong> 経過し設備が劣化しています。<br>
        今すぐ改修すると基本トラブル率が <strong class="text-negative">${info.currentProbPercent}%</strong> ➔ <strong class="text-positive">${info.afterProbPercent}%</strong> に大幅低下します！
      </div>`;

  const bodyHtml = `
    ${statusBanner}
    <table class="compact-table">
      <tbody>
        <tr>
          <th>🔨 臨時改修 基本費用</th>
          <td>${b.baseCost.toLocaleString()}万円</td>
        </tr>
        <tr>
          <th>🤝 住民協力金 (入居${b.occupancyRate}%・信頼${b.effectiveTrustForRepair})</th>
          <td class="text-positive">-${b.subsidyAmount.toLocaleString()}万円</td>
        </tr>
        <tr class="highlight-row">
          <th>💰 オーナー実質負担額</th>
          <td class="text-warning">${b.ownerBurden.toLocaleString()}万円</td>
        </tr>
        <tr>
          <th>└ 支払内訳（積立金 / 手元資金）</th>
          <td>積立 -${b.paidFromReserve.toLocaleString()}万 ／ 手元 -${b.paidFromFunds.toLocaleString()}万</td>
        </tr>
        <tr>
          <th>🎁 改修ボーナス</th>
          <td class="text-positive">全入居者の信頼+5・評判+3・次回定期修繕費軽減</td>
        </tr>
      </tbody>
    </table>
    ${
      !b.canAfford
        ? `<div class="text-negative" style="font-size:11.5px; font-weight:800;">⚠️ 積立金と手元資金の合計が ${b.shortfall.toLocaleString()}万円 不足しています。</div>`
        : ''
    }
  `;

  const actions = [{ label: 'キャンセル', className: 'btn-outline', onClick: () => closeModal() }];
  if (!info.alreadyRepairedThisTurn && b.canAfford) {
    actions.push({
      label: `🛠️ 臨時大規模改修を実行 (-${b.ownerBurden.toLocaleString()}万)`,
      className: 'btn-success',
      onClick: () => {
        const res = executeExtraRepair();
        closeModal();
        onStateChanged();
        showCustomModal(
          res.success ? '🛠️ 臨時大規模改修完了！' : 'エラー',
          `<p>${res.message}</p>`,
          [{ label: '確認', className: 'btn-primary', onClick: () => closeModal() }]
        );
      },
    });
  }

  showCustomModal('🛠️ 臨時大規模改修の実施', bodyHtml, actions, true);
}

/**
 * 5年ごとの大規模修繕完了モーダルを表示する
 * @param {object} repairResult executeScheduledRepairIfDue() の返り値
 */
export function showMajorRepairModal(repairResult) {
  const b = repairResult.breakdown;
  const bodyHtml = `
    <table class="compact-table">
      <tbody>
        <tr>
          <th>🔨 基本修繕費用</th>
          <td>${b.baseCost.toLocaleString()}万円</td>
        </tr>
        <tr>
          <th>🤝 住民協力金 (入居${b.occupancyRate}%・信頼${b.effectiveTrustForRepair})</th>
          <td class="text-positive">-${b.subsidyAmount.toLocaleString()}万円</td>
        </tr>
        <tr class="highlight-row">
          <th>💰 オーナー負担額</th>
          <td class="text-warning">${b.ownerBurden.toLocaleString()}万円</td>
        </tr>
        <tr>
          <th>└ 積立金充当 / 手元資金支出</th>
          <td>積立 ${b.paidFromReserve.toLocaleString()}万 / 手元 ${b.paidFromFunds.toLocaleString()}万</td>
        </tr>
      </tbody>
    </table>
    <div class="speech-bubble">
      残高 ➔ 積立金: <strong>${repairResult.remainingReserve.toLocaleString()}万</strong> ／ 手元資金: <strong>${repairResult.remainingFunds.toLocaleString()}万</strong>
    </div>
  `;

  showCustomModal(
    `🛠️ 第${repairResult.repairYear / 5}回 大規模修繕完了（${repairResult.repairYear}年目）`,
    bodyHtml,
    [{ label: '運営を続ける', className: 'btn-primary', onClick: () => closeModal() }],
    false
  );
}

/**
 * ゲームオーバーモーダルを表示する
 * @param {Function} onRestart 新規ゲーム開始コールバック
 */
export function showGameOverModal(onRestart) {
  const state = getState();
  const timeInfo = getTimeInfo(state.turn);

  const bodyHtml = `
    <div class="secret-report-box" style="border-color: var(--color-rose); color: #fda4af;">
      <strong>${state.gameOverReason}</strong>
    </div>
    <div class="dossier-specs">
      <div class="spec-item">
        <span class="spec-label">到達期間</span>
        <span class="spec-value">${timeInfo.formatted}（${state.turn}/${GAME_CONFIG.MAX_TURNS}T）</span>
      </div>
      <div class="spec-item">
        <span class="spec-label">最終手元資金</span>
        <span class="spec-value text-negative">${state.funds.toLocaleString()}万円</span>
      </div>
    </div>
  `;

  showCustomModal(
    `💸 ゲームオーバー`,
    bodyHtml,
    [
      { label: '盤面を見る', className: 'btn-outline', onClick: () => closeModal() },
      {
        label: '最初からやり直す',
        className: 'btn-primary',
        onClick: () => {
          closeModal();
          onRestart();
        },
      },
    ],
    false
  );
}

/**
 * ゲームクリアモーダルを表示する
 * @param {object} repairResult 60ターン目の大規模修繕結果
 * @param {Function} onRestart 新規ゲーム開始コールバック
 */
export function showGameClearModal(repairResult, onRestart) {
  const state = getState();

  const bodyHtml = `
    <div class="speech-bubble" style="border-left-color: var(--color-emerald); color: #a7f3d0;">
      <strong>🎉 15年間（全60ターン）・3回の大規模修繕をすべて乗り切りました！</strong>
    </div>
    <div class="dossier-specs">
      <div class="spec-item">
        <span class="spec-label">最終総資産</span>
        <span class="spec-value text-positive">${(state.funds + state.repairReserve).toLocaleString()}万円</span>
      </div>
      <div class="spec-item">
        <span class="spec-label">評判 / 入居率</span>
        <span class="spec-value">評判 ${state.reputation} ／ 入居 ${getOccupancyRate()}%</span>
      </div>
    </div>
  `;

  showCustomModal(
    `🏆 祝・ゲームクリア！`,
    bodyHtml,
    [
      { label: 'ビルを眺める', className: 'btn-outline', onClick: () => closeModal() },
      {
        label: '最初から遊ぶ',
        className: 'btn-primary',
        onClick: () => {
          closeModal();
          onRestart();
        },
      },
    ],
    false
  );
}

/**
 * ルール確認モーダルを表示する
 */
export function showHelpModal() {
  const mb = getMaintenanceCostBreakdown();
  const bodyHtml = `
    <div class="speech-bubble">
      <strong>🎯 目標：15年間（60ターン）破産せずビルを維持すればクリア！</strong>
    </div>
    <ul style="display:flex; flex-direction:column; gap:5px; font-size:11.5px;">
      <li>👆 <strong>3Dビル＆カード操作：</strong> 3Dビルの各フロアや各タブの<strong>カードをタップ</strong>すると詳細と操作が開きます（ドラッグで3D回転）。</li>
      <li>🏢 <strong>階層別固定維持費（計${mb.total}万/期）＆税金（${Math.round(GAME_CONFIG.TAX_RATE * 100)}%）：</strong> 低層1-5F(${mb.low}万)、中層6-8F(${mb.mid}万)、高層9-10F(${mb.high}万)が毎期発生し、<code>{収入－(維持費＋積立費)}×${Math.round(GAME_CONFIG.TAX_RATE * 100)}%</code> の税金が課されます（修繕積立に回すと節税効果あり）。</li>
      <li>⚡ <strong>階層別トラブル費用＆複数発生：</strong> トラブル解決費は低層(×1.0)に比べ中層(×2.2)・高層(×4.0)で高額になり、1室で複数件同時発生することもあります。</li>
      <li>🛠️ <strong>臨時大規模改修＆定期修繕(20・40・60T)：</strong> 改修から時間が経つほどトラブル発生率が上昇します。5年を待たずに「財務」タブから<strong>臨時大規模改修</strong>を行うとトラブル率を大幅に下げられます。</li>
    </ul>
  `;

  showCustomModal(
    `📖 ルール要点`,
    bodyHtml,
    [{ label: '閉じる', className: 'btn-primary', onClick: () => closeModal() }],
    true
  );
}
