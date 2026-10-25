/**
 * main.js
 * アプリケーションのエントリーポイント（初期化・イベント登録・全体描画制御）
 */

import {
  initNewState,
  getState,
  loadGame,
  saveGame,
  clearSaveData,
} from './state.js';
import { generateApplicantsForTurn } from './logic/screening.js';
import { advanceTurn } from './logic/turnManager.js';
import {
  renderHeader,
  renderBuildingList,
  renderBadgesAndFooter,
} from './ui/renderDashboard.js?v=20261026b';
import { renderActiveTab } from './ui/renderTabs.js?v=20261026b';
import {
  showMajorRepairModal,
  showGameOverModal,
  showGameClearModal,
  showHelpModal,
  showCustomModal,
  closeModal,
} from './ui/modal.js?v=20261026b';

/**
 * ダッシュボード全体のUIを再描画する
 */
export function refreshAllUI() {
  renderHeader();
  renderActiveTab(refreshAllUI);
  renderBuildingList(refreshAllUI);
  renderBadgesAndFooter();
}

/**
 * 新規ゲームを開始する
 */
function startNewGame() {
  clearSaveData();
  initNewState();
  generateApplicantsForTurn();
  saveGame();
  refreshAllUI();
}

/**
 * ターン進行処理を実行する
 */
function executeAdvanceTurn() {
  const result = advanceTurn();
  const state = getState();

  // 次の季節に移った際は常に「ビル断面」タブを開く
  state.activeTab = 'building';

  refreshAllUI();

  if (result.status === 'game_over') {
    showGameOverModal(() => startNewGame());
  } else if (result.status === 'game_clear') {
    showGameClearModal(result.repairResult, () => startNewGame());
  } else if (result.status === 'repair_completed' && result.repairResult) {
    showMajorRepairModal(result.repairResult);
  }
}

/**
 * 「次の季節へ」ボタン押下時のハンドラー
 */
function handleNextTurnClick() {
  const state = getState();
  if (state.isGameOver || state.isGameClear) return;

  if (state.troubles.length > 0) {
    showCustomModal(
      '⚡ 未対応のトラブルがあります',
      `<p>未対応のトラブルが <strong>${state.troubles.length}件</strong> あります。</p>
       <p>このまま進むとすべて<strong>「C. 塩対応（信頼-20、上下階-15、評判-5）」</strong>になります。よろしいですか？</p>`,
      [
        {
          label: 'トラブルを確認する',
          className: 'btn-outline',
          onClick: () => {
            closeModal();
            state.activeTab = 'trouble';
            refreshAllUI();
          },
        },
        {
          label: '塩対応で進む',
          className: 'btn-danger',
          onClick: () => {
            closeModal();
            executeAdvanceTurn();
          },
        },
      ]
    );
    return;
  }

  executeAdvanceTurn();
}

/**
 * アプリケーションの初期化
 */
function initApp() {
  const loaded = loadGame();
  if (!loaded) {
    startNewGame();
  } else {
    refreshAllUI();
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      const state = getState();
      if (targetTab && state.activeTab !== targetTab) {
        state.activeTab = targetTab;
        if (targetTab === 'log') {
          state.hasUnreadLog = false;
        }
        refreshAllUI();
      }
    });
  });

  const nextTurnBtn = document.getElementById('btn-next-turn');
  if (nextTurnBtn) {
    nextTurnBtn.addEventListener('click', handleNextTurnClick);
  }

  const helpBtn = document.getElementById('btn-help');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      showHelpModal();
    });
  }

  const resetBtn = document.getElementById('btn-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      showCustomModal(
        '🔄 リセット確認',
        '<p>現在の進行データをリセットして、1年目・春からやり直しますか？</p>',
        [
          { label: 'キャンセル', className: 'btn-outline', onClick: () => closeModal() },
          {
            label: 'やり直す',
            className: 'btn-danger',
            onClick: () => {
              closeModal();
              startNewGame();
            },
          },
        ]
      );
    });
  }
}

document.addEventListener('DOMContentLoaded', initApp);
