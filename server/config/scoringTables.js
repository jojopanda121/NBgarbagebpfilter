// ============================================================
// config/scoringTables.js — 评分量化映射表（参数显性化，全部可调）
//
// 哲学：LLM 只产事实和闭集枚举，打分一律查这里的表 / 套公式。
// shadow 校准期重点调这里，不要去改 scoringEvidence.js 里的逻辑。
// ============================================================

// ---------- S4 团队：教育档位表（子串匹配校名，命中最高档生效） ----------
// 注意：匹配的是 BP 自报校名（claimed 层），查表保证的是确定性与可解释，不是真伪。
const EDUCATION_TIERS = [
  {
    // v3：清北复交等顶尖学府 = 满分 10（子量表满分必须可达，修复旧 9 封顶）
    score: 10,
    keywords: [
      "清华", "北大", "北京大学", "复旦", "上海交通", "浙江大学", "中国科学技术大学",
      "南京大学", "西安交通", "哈尔滨工业",
      "Tsinghua", "Peking",
    ],
  },
  {
    score: 8,
    keywords: [
      // 985 常见
      "中山大学", "武汉大学", "华中科技", "同济", "北京航空", "北京理工", "东南大学",
      "天津大学", "厦门大学", "山东大学", "四川大学", "中南大学", "电子科技大学",
      "大连理工", "重庆大学", "吉林大学", "湖南大学", "兰州大学", "东北大学",
      "西北工业", "华南理工", "北京师范", "中国人民大学", "国防科技", "985",
      // 海外名校常见
      "麻省理工", "斯坦福", "哈佛", "伯克利", "卡内基", "牛津", "剑桥", "帝国理工",
      "新加坡国立", "南洋理工", "东京大学", "苏黎世联邦",
      "MIT", "Stanford", "Harvard", "Berkeley", "CMU", "Oxford", "Cambridge",
      "ETH", "NUS", "UCL",
    ],
  },
  {
    score: 7,
    keywords: [
      "211", "北京邮电", "上海财经", "中央财经", "对外经济贸易", "西安电子",
      "北京交通", "华东师范", "南京航空", "南京理工", "哈尔滨工程", "西南财经",
    ],
  },
  // 普通本科兜底：命中"大学/学院/本科/学士"但未中上面 → 5
  { score: 5, keywords: ["大学", "学院", "本科", "学士", "University", "College"] },
];
// 完全无教育信息 → 中性 6（与 dim4 缺失兜底口径一致：查不到 ≠ 差）
const EDUCATION_DEFAULT = 6;

// ---------- S4 团队：过往成绩查表 ----------
const TRACK_RECORD = {
  EXIT_KEYWORDS: ["退出", "并购", "被收购", "上市", "IPO"],   // 任一过往项目命中 → 10（v3 满分可达）
  RUNNING_KEYWORDS: ["运营", "在营", "存续"],                 // → 7
  FAIL_KEYWORDS: ["失败", "关闭", "解散", "清算"],            // ≥2 个失败项目 → 3
  HEAD_COMPANIES: [
    "阿里", "腾讯", "字节", "百度", "华为", "美团", "京东", "拼多多", "小米",
    "微软", "谷歌", "Google", "Meta", "亚马逊", "Amazon", "苹果", "Apple",
    "英伟达", "NVIDIA", "宁德时代", "比亚迪", "大疆", "商汤", "旷视",
  ],
  HEAD_EXEC_ROLES: ["总监", "VP", "副总裁", "高管", "总经理", "CTO", "CEO", "COO", "首席"],
  SCORE_EXIT: 10,
  SCORE_RUNNING: 7,
  SCORE_HEAD_EXEC: 6,    // 无创业史但有头部公司高管经历
  SCORE_MULTI_FAIL: 3,
  SCORE_DEFAULT: 5,      // 首次创业，无显著过往成绩
};

// ---------- S4 团队：完整性 / 赛道匹配 ----------
const TEAM_ROLES = {
  CEO: ["CEO", "创始人", "董事长", "总裁"],
  TECH: ["CTO", "技术", "首席科学家", "研发", "工程", "算法"],
  BIZ: ["COO", "销售", "商业", "市场", "CMO", "CRO", "运营", "BD"],
};
const COMPLETENESS_SCORES = { 3: 10, 2: 7, 1: 4, 0: 2 };
const COMPLETENESS_RISK_PENALTY = 2; // 命中"团队失衡/关键岗位缺失"(sev≥3) 的扣分
const DOMAIN_MATCH_SCORES = { "同赛道": 10, "相邻可迁移": 7, "跨界": 4 }; // 同赛道 = 满分 10（v3）
const DOMAIN_MATCH_DEFAULT = 6;

// ---------- S2 护城河：competitor agent 衍生 ----------
const MOAT_FROM_COMPETITOR = {
  // 重量级对手判定：直接竞品且轮次落在这些档
  HEAVY_STAGES: ["B轮", "C轮及以后", "已上市"],
  // density = clamp(100 − min(60, H×12) − min(20, (D−H)×4), 10, 100)
  HEAVY_PENALTY: 12,
  HEAVY_PENALTY_CAP: 60,
  LIGHT_PENALTY: 4,
  LIGHT_PENALTY_CAP: 20,
  DENSITY_FLOOR: 10,
  MIN_KNOWLEDGE_CONFIDENCE: 3, // 低于此把握度的竞品条目不计入密度
  TIER_SCORES: { "第一梯队": 85, "第二梯队": 65, "跟随者": 40, "边缘玩家": 20 },
  // 快速咽喉估计（深度版由 chokepoint_analysis skill 产出并覆盖）
  CHOKEPOINT_SCORES: { "强咽喉": 80, "弱咽喉": 45, "非咽喉型": 50 }, // 非咽喉型生意给中性，不惩罚
};
// 两路(Agent B × 专家)同一子因子分歧阈值：≤阈值视为一致(升verified)，>阈值取平均+记冲突
const MOAT_AGREEMENT_THRESHOLD = 25;

// ---------- S1：CAGR 上限表（competitor agent 的 track_maturity 锁增速） ----------
const CAGR_CAP_BY_MATURITY = {
  "萌芽": 40,
  "快速增长": 40,
  "趋于稳定": 25,
  "红海": 15,
  "衰退": 5,
};
// TAM 两源交叉：比值 ≤3 正常取几何平均；>3 仍取几何平均但记冲突
// （量级数据用几何平均——算术平均会被大数吞掉，这是"取平均"在对数量纲上的正确形式）
const TAM_CONFLICT_RATIO = 3;

// ---------- S1 增速：二阶加速（公司营收同比，奖励"小基数+高斜率"，基因⑤）----------
// 旧逻辑用市场 CAGR 当增速分；新逻辑优先用公司营收同比增速（YoY%），市场 CAGR
// 退为天花板辅助。寒武纪 2025H1 +43 倍、摩尔线程 +182% 是这一维要奖励的形状。
const S1_REVENUE_GROWTH_BRACKETS = [
  { minYoY: 300, score: 40 },  // +300% 以上（小基数爆发）
  { minYoY: 150, score: 36 },
  { minYoY: 80, score: 30 },
  { minYoY: 40, score: 24 },
  { minYoY: 20, score: 16 },
  { minYoY: 0, score: 8 },
  { minYoY: -Infinity, score: 0 }, // 负增长不给增速分
];
// 市场天花板辅助：市场 CAGR < 此值视为停滞/衰退赛道，公司爆发增速可疑 → 封顶
const S1_STAGNANT_MARKET_CAGR = 5;
const S1_STAGNANT_GROWTH_CAP = 16;

// ---------- S3：生意类型 / 规模机制 闭集枚举 → 分数 ----------
const BUSINESS_ARCHETYPE_SCORES = {
  "纯软件SaaS": 10,
  "平台双边市场": 9,
  "软硬结合": 6,
  "服务密集型": 5,
  "硬件fab-lite": 4,
  "重资产制造": 2,
};
const SCALE_MECHANISM_SCORES = {
  "双边网络效应": 10,
  "数据飞轮": 8,
  "规模经济": 6,
  "品牌渠道复利": 5,
  "线性人力交付": 2,
};
// 公司级实数修正（financial agent 实抽毛利率，小数 0-1）
const S3_GM_BONUS_THRESHOLD = 0.70;   // 毛利 ≥70% → +1
const S3_GM_PENALTY_THRESHOLD = 0.40; // 毛利 <40% → −1

// ============================================================
// S3 HARNESS（新版：资本壁垒溢价 + 新质生产力 + 成本曲线陡峭度）
//
// 与上面的旧 BUSINESS_ARCHETYPE_SCORES / SCALE_MECHANISM_SCORES 并存，由
// SCORING_S3_HARNESS 灰度开关(off/shadow/on)切换。设计见 scoringS3Harness.js。
//
// 修复旧 S3 三个结构性缺陷：
//   1) 资本密集=护城河时 S2/S3 自相矛盾 → 资本壁垒溢价(CBP)：玩家越少，资本门槛
//      越有效构成护城河，资本密集从减分翻成加分。
//   2) 新质重资产 ≠ 产能过剩重资产 → 新质生产力加分(N)：用市场CAGR+政策目录量化。
//   3) 资本来源/成本差异 → 资本耐心系数(λ)：国家大基金/政府主导的战略项目，资本
//      效率惩罚部分豁免（仅战略赛道生效，避免给产能过剩SOE放水）。
//   外加：规模陡峭度 → G = 规模类型分(ST) × 成本曲线陡峭度(k)，区分半导体良率驱动的
//      指数级规模与普通制造的近线性规模。
//
// 公式：S3 = clamp( CE + G + CBP + N + ΔGM, 0, 100 )
// ============================================================

// CE_base：资本效率基础分（0-38）。键沿用 Capital_Archetype 枚举以便回退兼容。
const S3H_CE_BASE = {
  "纯软件SaaS": 38,
  "平台双边市场": 35,
  "软硬结合": 23,
  "服务密集型": 20,
  "硬件fab-lite": 17,
  "重资产制造": 14,
};
const S3H_CE_BASE_DEFAULT = 23; // 查不到 → 软硬结合中性档
const S3H_CE_MAX = 38;          // 资本耐心豁免向上收敛的天花板

// ST：规模效应类型分（0-10）。键沿用 Scale_Mechanism 枚举。
const S3H_SCALE_TYPE = {
  "双边网络效应": 10,
  "数据飞轮": 8,
  "规模经济": 6,
  "品牌渠道复利": 5,
  "线性人力交付": 2,
};
const S3H_SCALE_TYPE_DEFAULT = 6;

// k：成本曲线陡峭度系数（以 Wright 学习率 LR=累计产量翻倍单位成本下降幅度 为锚）。
const S3H_STEEPNESS_K = {
  "指数级": 3.8,       // 边际成本趋零(软件/网络) 或 良率驱动 / 有效 LR≥20%
  "边际成本趋零": 3.8,
  "强学习曲线": 2.8,   // LR 15-20%
  "中等学习曲线": 2.0, // LR 10-15%
  "普通规模经济": 1.5, // LR 5-10%
  "近线性": 1.0,       // LR <5%（成熟商品化）
};
// 缺省 k：按规模类型推定（网络/飞轮天然更陡），其余给普通规模经济。
const S3H_STEEPNESS_DEFAULT_BY_SCALE = {
  "双边网络效应": 3.8,
  "数据飞轮": 2.8,
};
const S3H_STEEPNESS_DEFAULT = 1.5;
const S3H_G_MAX = 38;

// CBP：资本壁垒溢价 = 玩家稀缺分 × 资本密集闸门。
// 玩家稀缺分按全球/全国同类玩家数分档（玩家越少 = 资本门槛越有效）。
const S3H_SCARCITY_BRACKETS = [
  { maxPlayers: 5, score: 16 },
  { maxPlayers: 15, score: 10 },
  { maxPlayers: 50, score: 5 },
  { maxPlayers: Infinity, score: 0 },
];
// 资本密集闸门：仅这些资产模式可获溢价（资本门槛才构成护城河；轻资产靠 CE 已高）。
const S3H_CAPITAL_GATE_ARCHETYPES = ["重资产制造", "硬件fab-lite", "软硬结合"];

// N：新质生产力 = 成长性分(CAGR) + 政策优先级分。
const S3H_GROWTH_BRACKETS = [
  { minCagr: 25, score: 9 },
  { minCagr: 15, score: 6 },
  { minCagr: 8, score: 3 },
  { minCagr: -Infinity, score: 0 },
];
const S3H_GROWTH_DEFAULT = 3; // CAGR 查不到 → 8-15% 中性档（低置信）
const S3H_POLICY_TIER = {
  "国家级": 7, // 列入国家战略性新兴产业/未来产业目录 + 国家级专项/大基金支持
  "省级": 3,   // 地方战略性新兴产业 / 专精特新方向
  "无": 0,
};
const S3H_POLICY_DEFAULT = 0;

// λ：资本耐心系数（gating：仅政策优先级≥阈值的战略赛道才允许豁免）。
const S3H_CAPITAL_SOURCE_LAMBDA = {
  "大基金主导": 0.20, // 国家大基金+省市政府主导，长期限低成本
  "国资参与": 0.10,   // 国资/产业基金参与但非主导
  "市场化": 0,        // 纯 VC/PE/产业资本
};
const S3H_CAPITAL_SOURCE_DEFAULT = 0;
const S3H_PATIENCE_POLICY_GATE = 3; // Pol ≥ 此值（至少省级战略）才允许耐心豁免

// ΔGM：毛利修正（细化原 ±1 逻辑；gm 为小数 0-1）。
const S3H_GM_BRACKETS = [
  { minGm: 0.70, adj: 6 },
  { minGm: 0.50, adj: 3 },
  { minGm: 0.40, adj: 0 },
  { minGm: 0.30, adj: -3 },
  { minGm: -Infinity, adj: -6 },
];

// ---------- S5：财务异常 → claim_verdict 映射（对称：奖保守、罚有证据的隐瞒） ----------
// 设计原则："LLM 查不到 / BP 没写" = 存疑(6分及格,无罪推定)；
//          只有带证据的刻意选择性披露才打"信息不对称"(2分)。
const ANOMALY_VERDICT_MAP = {
  "数学矛盾": { 5: "证伪", 3: "夸大", 0: "存疑" },        // 键=严重度下限
  "增速异常": { 4: "夸大", 0: "存疑" },
  "行业偏离": { 4: "夸大", 0: "存疑" },
  "时间矛盾": { 4: "夸大", 0: "存疑" },
  "模糊措辞": { 0: "存疑" },
  "数据缺失": { 0: "存疑" },
  "其他": { 0: "存疑" },
};
const HIDDEN_SIGNAL_SEVERITY_FLOOR = 4; // hidden_signals 带证据且 sev≥4 → 信息不对称
const VALUATION_POSITION_VERDICTS = {
  "远高于": "夸大",
  "偏高": "存疑",
  // "合理" 不产条目（不灌水）
  "偏低": "保守低估",
  "远低于": "保守低估",
};
const SPECIALIST_VERDICT_CAPS = { negative: 5, positive: 3 }; // 防单 agent 淹没 S5

// ---------- 两路分歧通用规则（用户决策：取平均值 + 记冲突） ----------
const TEAM_AGREEMENT_THRESHOLD = 3; // 1-10 分制下两路差 >3 档 → 取平均 + 记冲突

// ============================================================
// 投资判断内核 v3 —— 聚合层（方案乙）+ 政策融入 参数
//
// 哲学：打破"五维算术平均把分数压在 70-78"的根因。
//   1) 非线性聚合：赛道相关加权 + 卓越加成（每有一维≥90 给 α，封顶），
//      容忍单点短板（重资产 S3 偏低不再单独把总分压下 80）。
//   2) 政策不设独立维度，融入 S1（需求侧：政策保障的需求→抬天花板）与
//      S3（资本侧：廉价耐心资本 + 资本壁垒，现有 harness 已含）。两通道
//      量不同机制、不重叠，故无双计。政策契合度仍显式 readout，不进平均。
//   3) A 级共振 gate：评级 A 要求 total≥80 且 ≥2 维≥80，防单维（含被政策
//      抬高的 S1）独大上 A —— 堵 PPT 概念股放水后门。
// 全部集中此处，shadow 校准期只调这里，便于按政策年度更新与校准写回。
// ============================================================

// ---------- 赛道相关权重（五维，和必须=1）----------
// 硬科技/战略赛道：下调 S3 资本效率权重（重资产是健康信号，不该高权重惩罚），
// 上调 S2 咽喉壁垒权重（卡脖子国产唯一是这类标的的核心 alpha）。S5 诚信不降权。
const AGG_TRACK_WEIGHTS = {
  general: { S1: 0.20, S2: 0.20, S3: 0.20, S4: 0.20, S5: 0.20 },
  hardtech: { S1: 0.20, S2: 0.24, S3: 0.16, S4: 0.20, S5: 0.20 },
};
const AGG_DEFAULT_TRACK = "general";

// ---------- 卓越加成 + A 级共振 gate ----------
const AGG_EXCELLENCE_THRESHOLD = 90; // 维度≥此值算"卓越"
const AGG_EXCELLENCE_ALPHA = 2;      // 每有一维卓越，基础分 + α
const AGG_EXCELLENCE_BONUS_CAP = 6;  // 卓越加成上限（最多顶 3 维）
const AGG_RESONANCE_GATE_N = 2;      // A 级要求至少 N 维 ≥ 共振阈值
const AGG_RESONANCE_GATE_SCORE = 80; // 共振阈值

// ---------- 分布与置信度（早期项目假精度 → 总分以分布呈现）----------
// 区间半宽 δ = 基础 + (1−平均coverage)×放大；coverage 越低，区间越宽、置信越低。
const AGG_RANGE_BASE_DELTA = 4;       // 满覆盖时的固有不确定性（±4）
const AGG_RANGE_COVERAGE_SCALE = 11;  // 覆盖不足额外放大（最多再 +11）
const AGG_CONFIDENCE_BANDS = [
  { minCoverage: 0.75, label: "高" },
  { minCoverage: 0.5, label: "中" },
  { minCoverage: -Infinity, label: "低" },
];

// ============================================================
// 政策契合度档位表（融入 S1/S3 的依据；集中、可年度更新）
// 依据"十五五"规划建议(2025.10)及工信部/发改委 2025-2026 表述。
// tier_base：政策契合度 readout 基础分（仅展示/回测，不进加权平均）。
// s1_demand：注入 S1 的需求侧加成（政策保障/抑制需求 → 抬/压天花板）。
// ============================================================
const POLICY_TIERS = {
  // 第一档 关键核心技术攻关（超常规措施、全链条攻关）
  "第一档": { tier_base: 95, s1_demand: 12, label: "关键核心技术攻关" },
  // 第二档 战略性新兴产业集群
  "第二档": { tier_base: 85, s1_demand: 8, label: "战略性新兴产业" },
  // 第三档 前瞻布局的未来产业（萌芽期，给高分但高不确定性）
  "第三档": { tier_base: 82, s1_demand: 6, label: "未来产业（萌芽期）" },
  // 第四档 受支持但非前沿的传统/一般产业
  "第四档": { tier_base: 50, s1_demand: 0, label: "一般产业" },
  // 第五档 政策不鼓励/产能过剩/限制类
  "第五档": { tier_base: 20, s1_demand: -18, label: "产能过剩/限制类" },
};
const POLICY_TIER_DEFAULT = null; // 无法归类 → 不归类（降 coverage，不默认中性）

// 政策修正项（叠加在档位上）
const POLICY_MODIFIERS = {
  // 卡脖子/国产替代刚需（进口依赖高、外资垄断）→ 需求有保障 + readout 加分
  chokepoint_substitution: { s1_demand: 6, readout: 8, label: "卡脖子/国产替代刚需" },
  // 已进入国家级/省级产业基金、大基金、国资 LP 布局 → 主要走 S3 资本侧；此处仅 readout 信号
  state_capital: { s1_demand: 0, readout: 4, label: "国资/大基金布局" },
  // 地缘政治/出口管制风险敞口大 → 资本侧诚实扣分 + readout 扣分（政策利好但执行风险高）
  geopolitical_high: { s3_capital: -6, readout: -5, label: "地缘/出口管制风险敞口大" },
  geopolitical_medium: { s3_capital: -3, readout: -3, label: "地缘风险中等" },
};
// 纯概念无产业化路径 → 取该档下沿（s1_demand 减半，readout 打折）
const POLICY_NO_INDUSTRIALIZATION_FACTOR = 0.5;
// s1_demand 注入 S1 的总钳制范围（避免政策单通道把 S1 吹爆/打死）
const POLICY_S1_DEMAND_CLAMP = { min: -20, max: 18 };

// 赛道大类 → 政策档位 默认映射（pipeline 无显式 Policy_Rubric.tier 时据此派生，
// 保证生产环境有覆盖；显式归类优先）。键对齐 pipelineService.INDUSTRY_CATEGORIES。
const INDUSTRY_POLICY_TIER = {
  "芯片半导体": "第一档",
  "人工智能": "第二档",
  "具身智能": "第三档",
  "低空经济": "第二档",
  "商业航天": "第二档",
  "合成生物": "第三档",
  "新能源": "第二档",
  "生物医药": "第二档",
  "先进制造": "第二档",
  "企业服务/SaaS": "第四档",
  "消费/零售": "第四档",
  "金融科技": "第四档",
  "其他": null,
};
// 走硬科技权重档的赛道（其余走 general）
const HARDTECH_POLICY_TIERS = new Set(["第一档", "第二档", "第三档"]);

module.exports = {
  EDUCATION_TIERS,
  EDUCATION_DEFAULT,
  TRACK_RECORD,
  TEAM_ROLES,
  COMPLETENESS_SCORES,
  COMPLETENESS_RISK_PENALTY,
  DOMAIN_MATCH_SCORES,
  DOMAIN_MATCH_DEFAULT,
  MOAT_FROM_COMPETITOR,
  MOAT_AGREEMENT_THRESHOLD,
  CAGR_CAP_BY_MATURITY,
  TAM_CONFLICT_RATIO,
  S1_REVENUE_GROWTH_BRACKETS,
  S1_STAGNANT_MARKET_CAGR,
  S1_STAGNANT_GROWTH_CAP,
  BUSINESS_ARCHETYPE_SCORES,
  SCALE_MECHANISM_SCORES,
  S3_GM_BONUS_THRESHOLD,
  S3_GM_PENALTY_THRESHOLD,
  // S3 harness 新版表
  S3H_CE_BASE,
  S3H_CE_BASE_DEFAULT,
  S3H_CE_MAX,
  S3H_SCALE_TYPE,
  S3H_SCALE_TYPE_DEFAULT,
  S3H_STEEPNESS_K,
  S3H_STEEPNESS_DEFAULT_BY_SCALE,
  S3H_STEEPNESS_DEFAULT,
  S3H_G_MAX,
  S3H_SCARCITY_BRACKETS,
  S3H_CAPITAL_GATE_ARCHETYPES,
  S3H_GROWTH_BRACKETS,
  S3H_GROWTH_DEFAULT,
  S3H_POLICY_TIER,
  S3H_POLICY_DEFAULT,
  S3H_CAPITAL_SOURCE_LAMBDA,
  S3H_CAPITAL_SOURCE_DEFAULT,
  S3H_PATIENCE_POLICY_GATE,
  S3H_GM_BRACKETS,
  ANOMALY_VERDICT_MAP,
  HIDDEN_SIGNAL_SEVERITY_FLOOR,
  VALUATION_POSITION_VERDICTS,
  SPECIALIST_VERDICT_CAPS,
  TEAM_AGREEMENT_THRESHOLD,
  // 聚合层（方案乙）
  AGG_TRACK_WEIGHTS,
  AGG_DEFAULT_TRACK,
  AGG_EXCELLENCE_THRESHOLD,
  AGG_EXCELLENCE_ALPHA,
  AGG_EXCELLENCE_BONUS_CAP,
  AGG_RESONANCE_GATE_N,
  AGG_RESONANCE_GATE_SCORE,
  AGG_RANGE_BASE_DELTA,
  AGG_RANGE_COVERAGE_SCALE,
  AGG_CONFIDENCE_BANDS,
  // 政策融入
  POLICY_TIERS,
  POLICY_TIER_DEFAULT,
  POLICY_MODIFIERS,
  POLICY_NO_INDUSTRIALIZATION_FACTOR,
  POLICY_S1_DEMAND_CLAMP,
  INDUSTRY_POLICY_TIER,
  HARDTECH_POLICY_TIERS,
};
