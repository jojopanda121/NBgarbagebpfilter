import React from "react";
import { useNavigate } from "react-router-dom";
import { Gavel, ArrowLeft } from "lucide-react";
import VerdictCard from "../components/VerdictCard";
import ScoreVisualizer from "../components/ScoreVisualizer";
import DetailedReport from "../components/DetailedReport";

// 预设的示例报告数据
const DEMO_RESULT = {
  success: true,
  elapsed_seconds: 12.5,
  extracted_data: {
    company_name: "智元科技有限公司",
    industry: "AI 大模型应用",
    product_name: "企业级智能文档分析平台",
    founded_year: "2022",
    team_size: "约30人",
    location: "北京",
    website: "zhiyuai.com",
    founder_names: "CEO 张明、CTO 李华、COO 王芳",
    business_model: "B2B SaaS",
    target_market: "中大型企业",
  },
  industry: "AI 大模型应用",
  deep_research: `## 深度分析报告

### 项目概况
智元科技是一家专注于企业级 AI 文档处理的科技公司，主打产品为"智元文档"智能分析平台。公司成立于2022年，总部位于北京，目前团队约30人。

### 行业分析
AI 文档处理赛道近年来发展迅速，预计到 2025 年市场规模将达到 50 亿美元。该领域主要玩家包括 OpenAI、Anthropic 以及众多垂直领域创业公司。

### 风险提示
1. 市场竞争激烈，头部云厂商可能快速跟进
2. 企业级产品落地周期长，付费转化需要时间
3. 技术人才成本持续上升

### 建议
建议进一步核实 BP 中提到的客户案例数据，并关注竞品动态。`,
  verdict: {
    total_score: 62,
    grade: "C",
    grade_label: "中等风险",
    grade_action: "建议深入尽调后决策，关注团队执行力和产品落地能力",
    grade_color: "text-yellow-500",
    verdict_summary: "项目有一定技术亮点，但存在估值偏高、市场竞争风险等问题",
    dimensions: {
      timing_ceiling: {
        score: 65,
        label: "时间与天花板",
        subtitle: "市场时机与增长空间",
        weight: 0.25,
        finding: "AI 文档处理赛道处于快速增长期，但市场教育仍需时间",
        bp_claim: "2025年市场规模50亿美元",
        ai_finding: "市场规模预测基本合理，但竞争激烈",
      },
      product_moat: {
        score: 55,
        label: "产品与护城河",
        subtitle: "竞争壁垒与差异化",
        weight: 0.25,
        finding: "技术有一定积累，但缺乏明显的护城河",
        bp_claim: "自研核心算法，准确率领先",
        ai_finding: "算法优势不明显，开源模型快速追赶",
      },
      business_validation: {
        score: 60,
        label: "商业验证",
        subtitle: "付费客户与收入",
        weight: 0.2,
        finding: "已有少量付费客户，但规模化仍需时间",
        bp_claim: "签约50+企业客户",
        ai_finding: "客户数量待核实，需进一步验证",
      },
      team: {
        score: 70,
        label: "团队基因",
        subtitle: "创始人背景与团队",
        weight: 0.2,
        finding: "团队技术背景较强，但商业化能力待验证",
        bp_claim: "核心团队来自BAT",
        ai_finding: "团队背景基本属实",
      },
      external_risk: {
        score: 60,
        label: "外部风险",
        subtitle: "政策与竞争风险",
        weight: 0.1,
        finding: "面临大厂竞争压力，政策风险较低",
        bp_claim: "政策支持 AI 发展",
        ai_finding: "国内政策环境相对友好",
      },
    },
    risk_flags: [
      "估值偏高",
      "竞争激烈",
      "付费转化周期长",
      "客户数据待核实",
      "护城河不够深",
    ],
    strengths: [
      "技术团队背景好",
      "赛道前景广阔",
      "已有客户案例",
      "创始团队互补性强",
    ],
    conflicts: [],
    claim_verdicts: [
      {
        category: "市场规模",
        original_claim: "2025年市场规模50亿美元",
        verdict: "基本属实",
        diff: "公开数据显示45-55亿美元",
        severity: "低",
      },
      {
        category: "客户数量",
        original_claim: "签约50+企业客户",
        verdict: "待核实",
        diff: "公开渠道仅查到10+家",
        severity: "中",
      },
      {
        category: "技术优势",
        original_claim: "自研核心算法，准确率领先",
        verdict: "存疑",
        diff: "未找到独立评测数据",
        severity: "中",
      },
      {
        category: "融资规模",
        original_claim: "已完成A轮3000万元融资",
        verdict: "基本属实",
        diff: "工商信息显示完成A轮",
        severity: "低",
      },
      {
        category: "团队规模",
        original_claim: "团队50人，核心技术来自BAT",
        verdict: "部分夸大",
        diff: "公开信息显示约30人",
        severity: "中",
      },
    ],
    valuation_comparison: {
      bp_multiple: 25,
      industry_avg_multiple: 15,
      overvalued_pct: 67,
      industry_name: "AI 企业服务",
      data_source: "MiniMax AI 知识库分析",
      analysis: "BP 估值显著高于行业平均水平，需谨慎",
    },
    // 新增：融资历史
    funding_history: [
      { round: "天使轮", amount: "500万元", date: "2022.06", investor: "某天使投资人" },
      { round: "Pre-A", amount: "1000万元", date: "2023.03", investor: "创新工场" },
      { round: "A轮", amount: "3000万元", date: "2024.01", investor: "红杉中国" },
    ],
    // 新增：团队详情
    team_details: [
      {
        name: "张明",
        role: "CEO",
        background: "前阿里产品专家，10年+企业服务经验",
        verified: true,
      },
      {
        name: "李华",
        role: "CTO",
        background: "前百度技术专家，AI方向博士",
        verified: true,
      },
      {
        name: "王芳",
        role: "COO",
        background: "前腾讯运营经理，有成功创业经验",
        verified: false,
      },
    ],
    // 新增：竞品对比
    competitor_analysis: [
      {
        name: "智元文档",
        advantages: "本地部署能力、定制化服务",
        disadvantages: "品牌认知度低、规模小",
        pricing: "中高端",
      },
      {
        name: "通义听悟",
        advantages: "阿里生态、品牌强、流量大",
        disadvantages: "通用能力强但垂直度不够",
        pricing: "中端",
      },
      {
        name: "Notion AI",
        advantages: "产品体验好、用户基数大",
        disadvantages: "国内服务不稳定、价格偏高",
        pricing: "高端",
      },
      {
        name: "讯飞智文",
        advantages: "科大讯飞品牌、语音技术强",
        disadvantages: "AI能力相对较弱",
        pricing: "中低端",
      },
    ],
    // 新增：行业洞察
    industry_insights: {
      market_trends: [
        "AI 文档处理市场年复合增长率达 28%",
        "企业级需求从通用向垂直细分",
        "本地部署需求持续增长（数据安全考量）",
        "大模型价格战推动应用普及",
      ],
      opportunity: [
        "政策支持：各地出台 AI 扶持政策",
        "降本需求：企业文档处理成本压力大",
        "效率提升：传统方式效率低，AI 可大幅提升",
      ],
      threat: [
        "大厂入场：阿里、腾讯、字节纷纷布局",
        "开源冲击：开源模型能力快速提升",
        "经济周期：企业IT支出可能收缩",
      ],
    },
    // 新增：投资建议
    investment_suggestion: {
      recommendation: "谨慎跟进",
      rationale: [
        "赛道前景可期，但竞争激烈",
        "团队技术能力 OK，商业化能力待验证",
        "估值偏高，建议降低预期",
      ],
      next_steps: [
        "安排与创始人深入沟通",
        "要求提供客户签约合同等证明材料",
        "联系现有投资方了解更多信息",
        "进行技术团队背景独立尽调",
      ],
      timeline: "建议在3个月内完成尽调",
    },
  },
};

export default function DemoReportPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate("/")}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Gavel className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">垃圾BP过滤机</span>
          </div>

          <button
            onClick={() => navigate("/login")}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors font-medium"
          >
            立即开始分析
          </button>
        </div>
      </header>

      {/* 示例标记 */}
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 py-2 text-center text-sm text-yellow-400">
        这是示例报告 - 展示系统分析能力，登录后可分析真实的商业计划书
      </div>

      {/* 返回按钮 */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回首页
        </button>
      </div>

      {/* 报告内容 */}
      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* 公司信息 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">
            {DEMO_RESULT.extracted_data.company_name}
          </h1>
          <p className="text-gray-400">
            {DEMO_RESULT.extracted_data.industry} · {DEMO_RESULT.extracted_data.product_name}
          </p>
        </div>

        {/* 评分结果 */}
        <VerdictCard result={DEMO_RESULT} />

        {/* 五维雷达图 */}
        <div className="mt-6">
          <ScoreVisualizer verdict={DEMO_RESULT.verdict} />
        </div>

        {/* 详细报告 */}
        <div className="mt-6">
          <DetailedReport result={DEMO_RESULT} />
        </div>
      </main>

      {/* CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent py-6 text-center">
        <button
          onClick={() => navigate("/login")}
          className="px-8 py-3 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-400 hover:to-orange-400 rounded-xl font-bold text-lg transition-all"
        >
          立即分析你的 BP
        </button>
      </div>
    </div>
  );
}
