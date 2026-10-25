/**
 * config.js
 * ゲーム全体の定数およびバランス調整用パラメーター定義
 */

export const GAME_CONFIG = {
  /** ビルの総階数（プロトタイプは10階、100階へ拡張可能） */
  TOTAL_FLOORS: 10,

  /** 1年あたりのターン数（春・夏・秋・冬の四半期制） */
  TURNS_PER_YEAR: 4,

  /** クリア目標年数（15年） */
  TARGET_YEARS: 15,

  /** クリア目標総ターン数（60ターン） */
  MAX_TURNS: 60,

  /** 季節ラベル配列 */
  SEASONS: ['春', '夏', '秋', '冬'],

  /** 初期手元資金（単位：万円） */
  INITIAL_FUNDS: 1500,

  /** 初期修繕積立金（単位：万円） */
  INITIAL_REPAIR_RESERVE: 0,

  /**
   * 法人・不動産所得の実効税率（30%）
   * 課税対象額 ＝ max(0, 家賃実収入 － (維持費合計 ＋ 積立費))
   */
  TAX_RATE: 0.3,

  /** 初期ビル評判（0〜100） */
  INITIAL_REPUTATION: 50,

  /** 入居世帯の初期信頼度（0〜100） */
  INITIAL_TRUST: 60,

  /** 空室のまま1ターン経過するごとの募集家賃自動下落率（5%） */
  VACANCY_RENT_DROP_RATE: 0.05,

  /** 募集家賃の下限比率（初期適正家賃の50%） */
  MIN_RENT_RATIO: 0.5,

  /** 募集家賃の手動変更上限比率（初期適正家賃の200%） */
  MAX_RENT_RATIO: 2.0,

  /**
   * 財務タブ「次期家賃」一括改定（5％増額 / 5％減額）のトレードオフ設定
   * ・5％増額：次期家賃 +5% ⇔ 全入居世帯の信頼度 -10 ／ ビル評判 -4
   * ・5％減額：次期家賃 -5% ⇔ 全入居世帯の信頼度 +10 ／ ビル評判 +4
   */
  NEXT_RENT_CHANGE_RATE: 0.05,
  NEXT_RENT_UP_TRUST_DELTA: -10,
  NEXT_RENT_UP_REPUTATION_DELTA: -4,
  NEXT_RENT_DOWN_TRUST_DELTA: 10,
  NEXT_RENT_DOWN_REPUTATION_DELTA: 4,

  /** 追加調査（興信所オプション）の費用（単位：万円） */
  INVESTIGATION_COST: 50,

  /** 追加調査による信憑性の上昇値（+25%） */
  INVESTIGATION_CREDIBILITY_BOOST: 25,

  /** 通常の強制退去における立ち退き料倍率（現在家賃の3ターン分） */
  EVICTION_MULTIPLIER_NORMAL: 3,

  /** 悪人・反社に対する強制退去の立ち退き料倍率（現在家賃の5ターン分） */
  EVICTION_MULTIPLIER_BAD: 5,

  /** 愛想尽かし退去が発生する信頼度しきい値（20以下） */
  LOW_TRUST_THRESHOLD: 20,

  /** 愛想尽かし退去の発生確率（毎ターン50%） */
  LOW_TRUST_LEAVE_PROBABILITY: 0.5,

  /** 善人・普通世帯が愛想尽かし退去した際のビル評判ペナルティ */
  LOW_TRUST_REPUTATION_PENALTY: 5,

  /** ライフステージ退去（自然退去）が発生し始める入居経過ターン数（3年＝12ターン） */
  NATURAL_LEAVE_MIN_TURNS: 12,

  /** ライフステージ退去の発生確率（毎ターン10%） */
  NATURAL_LEAVE_PROBABILITY: 0.1,

  /** 低層階で高齢世帯へ変化する入居経過ターン数（5年＝20ターン） */
  AGING_THRESHOLD_TURNS: 20,

  /** 高齢世帯が毎ターン家賃を滞納する確率（15%） */
  AGING_ARREARS_PROBABILITY: 0.15,

  /** 高齢世帯の大規模修繕時における実質信頼度ボーナス */
  AGING_REPAIR_TRUST_BONUS: 15,

  /** 悪人・反社がビル内に1世帯存在するごとのターン終了時評判ペナルティ */
  BAD_TENANT_REPUTATION_PENALTY: 2,

  /**
   * トラブル発生率と大規模改修からの経過ターン連動パラメーター
   * 基本トラブル率 (baseProb) = min(60%, 5% + 経過期数 × 2.5%)
   */
  BASE_TROUBLE_PROB_AFTER_REPAIR: 0.05,
  TROUBLE_PROB_INCREASE_PER_TURN: 0.025,
  MAX_TROUBLE_PROB_PER_ROLL: 0.60,

  /** 1入居者あたりの毎ターン基本トラブル抽選回数（2件以上同時発生可能・上限件数なし） */
  TROUBLE_ROLLS_PER_TENANT: 2,

  /**
   * 低確率で発生する「緊急大規模改修」トラブルの発生確率パラメーター
   * 初期発生率 5%、1期経過ごとに +0.25% 上昇、最大 10%
   */
  EMERGENCY_REPAIR_BASE_PROB: 0.05,
  EMERGENCY_REPAIR_PROB_INCREASE_PER_TURN: 0.0025,
  EMERGENCY_REPAIR_MAX_PROB: 0.10,

  /**
   * 階層別のトラブル対応費用倍率
   * 低層階をベース(1.0倍)とし、中層階は2.2倍、高層階は4.0倍と大幅に高くなる
   */
  TROUBLE_COST_MULTIPLIER: {
    low: 1.0,
    mid: 2.2,
    high: 4.0,
  },

  /** 5年（20ターン）ごとの定期大規模修繕スケジュールと基本修繕費用（10階基準・万円） */
  REPAIR_SCHEDULE: {
    20: 1500, // 5年目（20ターン目）：1,500万円
    40: 2500, // 10年目（40ターン目）：2,500万円
    60: 4000, // 15年目（60ターン目）：4,000万円
  },

  /** 住民協力金の算出係数（基本修繕費用 × 入居率 × 全体平均信頼度 × 0.6） */
  REPAIR_SUBSIDY_FACTOR: 0.6,

  /**
   * 階層区分の定義（低層・中層・高層で1フロアあたりの固定維持費を個別設定）
   * 10階モデル合計維持費：低層(12万×5F=60万) ＋ 中層(30万×3F=90万) ＋ 高層(100万×2F=200万) ＝ 350万円/期
   */
  FLOOR_TIERS: {
    LOW: {
      id: 'low',
      name: '低層階',
      targetName: 'ファミリー・一般',
      maxRatio: 0.5,
      standardRent: 40,
      maintenanceCostPerFloor: 12,
      troubleCostMultiplier: 1.0,
      description: '応募が多いが玉石混交。高齢化や生活騒音が発生しやすい。',
    },
    MID: {
      id: 'mid',
      name: '中層階',
      targetName: 'オフィス・テナント',
      maxRatio: 0.8,
      standardRent: 120,
      maintenanceCostPerFloor: 30,
      troubleCostMultiplier: 2.2,
      description: '収益の柱。トラブル対応費は低層の2.2倍。反社・詐欺の混入リスクあり。',
    },
    HIGH: {
      id: 'high',
      name: '高層階',
      targetName: '富裕層',
      maxRatio: 1.0,
      standardRent: 300,
      maintenanceCostPerFloor: 100,
      troubleCostMultiplier: 4.0,
      description: '高収益だが固定維持費もトラブル対応費（低層の4倍）も極めて高額。',
    },
  },

  /** 見た目カテゴリ別の事前寸評信憑性パラメーター */
  APPEARANCE_CATEGORIES: {
    good: {
      id: 'good',
      label: '優良そう',
      baseCredibility: 90,
    },
    normal: {
      id: 'normal',
      label: '一般',
      baseCredibility: 70,
    },
    suspicious: {
      id: 'suspicious',
      label: 'ヤンキー・怪しい',
      baseCredibility: 45,
    },
  },

  /** 内部属性ラベル定義 */
  TRUE_NATURE_LABELS: {
    good: '善人・優良住民',
    normal: '一般住民',
    bad: '悪人・反社・クレーマー',
  },

  /** ローカルストレージのセーブキー */
  STORAGE_KEY: 'owner_wa_tsuraiyo_save_v1',
};

/**
 * 階数番号（1〜TOTAL_FLOORS）から該当する階層区分オブジェクトを取得する
 * @param {number} floorNumber 階数
 * @param {number} totalFloors 総階数
 * @returns {object} 階層区分定義オブジェクト
 */
export function getFloorTierConfig(floorNumber, totalFloors = GAME_CONFIG.TOTAL_FLOORS) {
  const ratio = floorNumber / totalFloors;
  if (ratio <= GAME_CONFIG.FLOOR_TIERS.LOW.maxRatio) {
    return GAME_CONFIG.FLOOR_TIERS.LOW;
  }
  if (ratio <= GAME_CONFIG.FLOOR_TIERS.MID.maxRatio) {
    return GAME_CONFIG.FLOOR_TIERS.MID;
  }
  return GAME_CONFIG.FLOOR_TIERS.HIGH;
}

/**
 * 低層・中層・高層ごとの毎ターン固定維持費内訳と合計額を算出する
 * @param {number} totalFloors 総階数
 * @returns {{ low: number, mid: number, high: number, total: number }} 階層別維持費（万円）
 */
export function getMaintenanceCostBreakdown(totalFloors = GAME_CONFIG.TOTAL_FLOORS) {
  let low = 0;
  let mid = 0;
  let high = 0;

  for (let f = 1; f <= totalFloors; f++) {
    const tier = getFloorTierConfig(f, totalFloors);
    if (tier.id === 'low') low += tier.maintenanceCostPerFloor;
    else if (tier.id === 'mid') mid += tier.maintenanceCostPerFloor;
    else high += tier.maintenanceCostPerFloor;
  }

  return {
    low,
    mid,
    high,
    total: low + mid + high,
  };
}

/**
 * 総階数に応じた毎ターンの基本維持費合計を算出する（10階モデルで350万円）
 * @param {number} totalFloors 総階数
 * @returns {number} 毎ターンの基本維持費合計（万円）
 */
export function getBaseMaintenanceCost(totalFloors = GAME_CONFIG.TOTAL_FLOORS) {
  return getMaintenanceCostBreakdown(totalFloors).total;
}

/**
 * 前回の大規模修繕（または臨時改修）からの経過ターン数に応じた基本トラブル発生確率（0〜1）を算出する
 * @param {number} turnsSinceLastRepair 前回修繕からの経過ターン数
 * @returns {number} 1抽選あたりの基本トラブル発生確率
 */
export function getBaseTroubleProbability(turnsSinceLastRepair = 0) {
  const rawProb =
    GAME_CONFIG.BASE_TROUBLE_PROB_AFTER_REPAIR +
    turnsSinceLastRepair * GAME_CONFIG.TROUBLE_PROB_INCREASE_PER_TURN;
  return Math.min(GAME_CONFIG.MAX_TROUBLE_PROB_PER_ROLL, rawProb);
}

/**
 * 現在のターンが属する期間に応じた通常大規模改修のベース費用（1,500万 / 2,500万 / 4,000万円）を取得する
 * @param {number} turn 現在のターン数
 * @param {number} totalFloors 総階数
 * @returns {number} ベース改修費用（万円）
 */
export function getCurrentPeriodRepairBaseCost(
  turn = 1,
  totalFloors = GAME_CONFIG.TOTAL_FLOORS
) {
  const scaleFactor = totalFloors / 10;
  if (turn <= 20) return Math.round(1500 * scaleFactor);
  if (turn <= 40) return Math.round(2500 * scaleFactor);
  return Math.round(4000 * scaleFactor);
}

/**
 * 指定ターンの定期大規模修繕基本費用を算出する（該当ターンでない場合は0）
 * ※直近で臨時大規模改修を実施していた場合は経過ターン数に応じて基本修繕費が軽減される
 * @param {number} turn 現在のターン数
 * @param {number} totalFloors 総階数
 * @param {number} turnsSinceLastRepair 前回修繕からの経過ターン数
 * @returns {number} 基本修繕費用（万円）
 */
export function getScheduledRepairBaseCost(
  turn,
  totalFloors = GAME_CONFIG.TOTAL_FLOORS,
  turnsSinceLastRepair = 20
) {
  const baseCostFor10Floors = GAME_CONFIG.REPAIR_SCHEDULE[turn];
  if (!baseCostFor10Floors) {
    return 0;
  }
  const scaleFactor = totalFloors / 10;
  // 直近で臨時改修を行っていた場合、劣化が少ない分だけ定期修繕の基本費用が最大35%軽減される（未実施時は19期経過で100%）
  const conditionFactor = Math.min(1.0, 0.65 + ((turnsSinceLastRepair + 1) / 20) * 0.35);
  return Math.round(baseCostFor10Floors * scaleFactor * conditionFactor);
}
