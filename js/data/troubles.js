/**
 * troubles.js
 * トラブルイベントの種類・選択肢・低層基準ベース費用定義
 * ※実際の発生時は階層倍率（低層×1.0 / 中層×2.2 / 高層×4.0）が乗算されます。
 */

export const TROUBLE_IMPACT_RULES = {
  A: {
    key: 'A',
    label: 'A. 一流業者で即修理',
    selfTrustDelta: 15,
    neighborTrustDelta: 0,
    reputationDelta: 2,
  },
  B: {
    key: 'B',
    label: 'B. 格安業者で応急処置',
    selfTrustDelta: 0,
    neighborTrustDelta: -5,
    reputationDelta: 0,
  },
  C: {
    key: 'C',
    label: 'C. 塩対応（放置）',
    selfTrustDelta: -20,
    neighborTrustDelta: -15,
    reputationDelta: -5,
  },
};

/**
 * 低確率で発生する「緊急大規模改修」トラブルの3択ルール
 * ※ベース費用は通常の大規模改修（1500万 / 2500万 / 4000万）と同じで、修繕積立金＋手元資金から支払い可能
 */
export const EMERGENCY_REPAIR_IMPACT_RULES = {
  A: {
    key: 'A',
    label: 'A. 全面緊急大規模改修（完全施工）',
    allTrustDelta: 15,
    reputationDelta: 5,
    effectSummary: '全室信頼 +15 ／ 評判 +5 ／ 劣化リセット(基本トラブル率6%へ低下)',
  },
  B: {
    key: 'B',
    label: 'B. 格安業者で応急大規模補修（40%施工）',
    allTrustDelta: -5,
    reputationDelta: 0,
    effectSummary: '全室信頼 -5 ／ 評判 ±0 ／ 劣化ターン半減(トラブル率やや低下)',
  },
  C: {
    key: 'C',
    label: 'C. 塩対応（緊急改修を見送り・放置）',
    allTrustDelta: -20,
    reputationDelta: -10,
    effectSummary: '全室信頼 -20 ／ 評判 -10 ／ 劣化進行(+3期・トラブル率さらに上昇)',
  },
};

export const EMERGENCY_REPAIR_TEMPLATES = [
  {
    id: 'emergency_main_pipe_collapse',
    title: '基幹配管・受水槽の破裂危機',
    description:
      '全館の基幹給排水管に深刻な亀裂が発覚。大規模改修規模の緊急工事が必要です。',
  },
  {
    id: 'emergency_exterior_wall_peel',
    title: '外壁タイル剥落・構造亀裂',
    description:
      '外壁タイルの広範囲な浮きと防水層の破断が発生。全面足場での緊急改修が必要です。',
  },
  {
    id: 'emergency_power_elevator_overhaul',
    title: '受変電設備・昇降機の基幹故障',
    description:
      '高圧受変電盤と昇降機制御系が限界に達し、全館規模の緊急改修が必要です。',
  },
];

export const TROUBLE_TEMPLATES = [
  {
    id: 'water_leak',
    title: '配管からの水漏れ',
    category: 'general',
    allowedTiers: ['low', 'mid', 'high'],
    description: '老朽配管から水漏れ！放置すると上下階にも浸水被害が広がります。',
    costA: 80,
    costB: 30,
    choiceTexts: {
      A: '緊急工事で即日完全復旧させた。',
      B: '格安修理で数日かかり上下階に湿気が漏れた。',
      C: '放置して水漏れが拡大し上下階から猛抗議！',
    },
  },
  {
    id: 'aircon_breakdown',
    title: '空調・換気設備の故障',
    category: 'general',
    allowedTiers: ['low', 'mid', 'high'],
    description: '空調と換気ダクトが停止。早急な修理を求められています。',
    costA: 70,
    costB: 25,
    choiceTexts: {
      A: '最新機器へ交換し快適性が向上した。',
      B: '中古部品で修理し作業騒音が上下階に響いた。',
      C: '修理を拒否し住民の信頼が大きく低下した。',
    },
  },
  {
    id: 'noise_trouble',
    title: '深夜の騒音・振動クレーム',
    category: 'general',
    allowedTiers: ['low', 'mid'],
    description: '深夜の足音や機器振動が響くと激しい苦情が発生しています。',
    costA: 55,
    costB: 20,
    choiceTexts: {
      A: '防音・防振施工を実施し円満解決した。',
      B: '注意チラシ投函のみで上下階の不満が残った。',
      C: '当事者任せで放置しフロア間の口論に発展！',
    },
  },
  {
    id: 'smell_drainage',
    title: '排水管からの逆流・異臭',
    category: 'general',
    allowedTiers: ['low', 'mid', 'high'],
    description: '排水詰まりで室内に汚水と下水臭が逆流しています。',
    costA: 65,
    costB: 25,
    choiceTexts: {
      A: '高圧洗浄車を手配し完全に消臭・洗浄した。',
      B: '薬剤投入のみで上下階にも臭いが残った。',
      C: '放置して悪臭が上下階まで充満した！',
    },
  },
  {
    id: 'elevator_door_fault',
    title: 'フロア扉・内壁の破損',
    category: 'general',
    allowedTiers: ['low', 'mid', 'high'],
    description: '共用廊下の防火扉とセンサーが故障し開閉不能になっています。',
    costA: 75,
    costB: 30,
    choiceTexts: {
      A: 'メーカー純正部品で即日交換・調整した。',
      B: '応急溶接で済ませ開閉音が上下階に響いた。',
      C: '放置して通行障害が続き大クレームに！',
    },
  },
  {
    id: 'electric_leakage',
    title: '分電盤の漏電・停電',
    category: 'general',
    allowedTiers: ['low', 'mid', 'high'],
    description: '経年劣化で分電盤がショートし、フロア一帯が不安定です。',
    costA: 85,
    costB: 35,
    choiceTexts: {
      A: '保安協会と専門業者を呼び全面改修した。',
      B: '一時的な配線バイパスで済ませ不安が残った。',
      C: '放置して停電が頻発し信頼が失墜した！',
    },
  },
  {
    id: 'window_seal_leak',
    title: '外壁サッシからの吹き込み',
    category: 'general',
    allowedTiers: ['low', 'mid', 'high'],
    description: 'シーリング劣化で強風時に雨水がサッシから浸入しています。',
    costA: 60,
    costB: 25,
    choiceTexts: {
      A: 'ゴンドラ足場を組み防水シーリングを打ち直した。',
      B: '室内側からの簡易コーキングで済ませた。',
      C: '放置して壁紙がカビだらけになり猛抗議！',
    },
  },
  {
    id: 'vip_security_trouble',
    title: '高層VIPセキュリティ障害',
    category: 'general',
    allowedTiers: ['high'],
    description: 'VIP専用生体認証ゲートと床暖房が故障し厳しい指摘が入っています。',
    costA: 95,
    costB: 40,
    choiceTexts: {
      A: '最高級システムへ即アップグレードした。',
      B: '格安業者のマナーが悪く周辺階から苦情が出た。',
      C: '放置して「三流ビル」と信頼が地に落ちた！',
    },
  },
  {
    id: 'vip_concierge_facility',
    title: '高層専用スパ・給湯設備故障',
    category: 'general',
    allowedTiers: ['high'],
    description: 'ペントハウス系統のジャグジー給湯圧が低下し改善を要求されています。',
    costA: 90,
    costB: 35,
    choiceTexts: {
      A: '高出力ボイラーへ即時交換し称賛された。',
      B: 'ボイラー応急調整の振動が下階に響いた。',
      C: '対応を後回しにして富裕層が激怒！',
    },
  },
  {
    id: 'office_power_network',
    title: 'オフィスの通信・電源断',
    category: 'general',
    allowedTiers: ['mid'],
    description: '光回線ユニットとOA電源が落ち、テナント業務がストップしています。',
    costA: 75,
    costB: 30,
    choiceTexts: {
      A: '夜間緊急工事で大容量設備へ改修完了した。',
      B: '昼間の突貫工事で上下階の業務に影響が出た。',
      C: '対応を拒否しテナントから損害賠償を示唆された！',
    },
  },
  {
    id: 'bad_tenant_nuisance',
    title: '悪質住民の共用部占拠',
    category: 'bad_tenant',
    allowedTiers: ['low', 'mid', 'high'],
    description: 'ガラが悪い関係者が廊下にたまり、騒音と吸い殻を撒き散らしています！',
    costA: 95,
    costB: 35,
    choiceTexts: {
      A: '弁護士と警備員を動員し厳重警告で鎮圧した。',
      B: '1回巡回させただけで再発し上下階が怯えている。',
      C: '見て見ぬふりをしてビルの治安と評判が悪化！',
    },
  },
  {
    id: 'bad_tenant_illegal_dump',
    title: '悪質住民の不法投棄・器物破損',
    category: 'bad_tenant',
    allowedTiers: ['low', 'mid', 'high'],
    description: '共用部に粗大ゴミや危険物を放置し、壁面を傷つけています！',
    costA: 90,
    costB: 35,
    choiceTexts: {
      A: '特別回収と防犯カメラ増設で徹底対処した。',
      B: '片付けのみで済ませ悪臭が上下階に広がった。',
      C: '放置してビル全体がスラム化し始めた！',
    },
  },
  {
    id: 'aged_health_smell',
    title: '高齢世帯のゴミ・異臭',
    category: 'aged',
    allowedTiers: ['low'],
    description: '高齢入居者が体調不良でゴミ出しできず異臭が漏れ始めています。',
    costA: 60,
    costB: 25,
    choiceTexts: {
      A: '支援機関と連携し特殊清掃と見守り設置を行った。',
      B: '簡易ゴミ回収のみで上下階に臭いが漏れた。',
      C: '放置して異臭が広がり救急車騒ぎになった！',
    },
  },
];
