import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Gavel,
  Shield,
  Zap,
  Search,
  TrendingUp,
  Users,
  ChevronRight,
  CheckCircle,
  Sparkles,
} from "lucide-react";

export default function LandingPage() {
  const navigate = useNavigate();

  const features = [
    {
      icon: <Search className="w-6 h-6" />,
      title: "联网证据核查",
      desc: "自动搜索公开信息，验证BP中的关键声明是否属实",
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "五维定量评分",
      desc: "时间天花板、产品护城河、商业验证、团队基因、外部风险",
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "AI 深度研究",
      desc: "基于 MiniMax M2.5 DeepThink 进行辩证式分析",
    },
    {
      icon: <TrendingUp className="w-6 h-6" />,
      title: "估值温度计",
      desc: "对比行业平均估值，判断项目是否存在估值泡沫",
    },
  ];

  const pricingPlans = [
    {
      name: "体验版",
      price: "免费",
      quota: "3次",
      features: ["基础五维评分", "关键声明核查", "估值对比", "报告下载"],
      highlighted: false,
    },
    {
      name: "专业版",
      price: "¥99",
      quota: "10次",
      features: ["体验版全部功能", "AI 深度研究", "优先处理", "历史报告存储"],
      highlighted: true,
    },
    {
      name: "企业版",
      price: "¥497",
      quota: "50次",
      features: ["专业版全部功能", "批量分析", "API 接入", "专属客服", "定制报告"],
      highlighted: false,
    },
  ];

  const stats = [
    { value: "2min", label: "快速识别" },
    { value: "98%", label: "准确率" },
    { value: "5000+", label: "已分析BP" },
    { value: "4.5", label: "用户评分" },
  ];

  return (
    <div className="min-h-screen">
      {/* ── 导航栏 ── */}
      <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
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

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/demo")}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
            >
              体验 Demo
            </button>
            <button
              onClick={() => navigate("/login")}
              className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              登录
            </button>
            <button
              onClick={() => navigate("/login")}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors font-medium"
            >
              立即开始
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero 区域 ── */}
      <section className="relative py-20 px-4 overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-orange-500/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-500/10 rounded-full blur-3xl" />

        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900/80 border border-gray-800 rounded-full text-sm text-gray-400 mb-6">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            <span>AI 驱动 · 2 分钟识破垃圾 BP</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            你的商业计划书
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400">
              经得起验证吗？
            </span>
          </h1>

          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto">
            90% 的商业计划书存在数据造假、夸大估值、虚构团队等问题。
            我们用 AI + 联网证据，让垃圾 BP 无处遁形。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate("/login")}
              className="px-8 py-3 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-400 hover:to-orange-400 rounded-xl font-bold text-lg transition-all transform hover:scale-105 flex items-center gap-2"
            >
              立即开始分析
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => navigate("/demo")}
              className="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl font-medium text-lg transition-colors"
            >
              查看示例报告
            </button>
          </div>
        </div>
      </section>

      {/* ── 统计数据 ── */}
      <section className="py-12 border-y border-gray-800 bg-gray-900/50">
        <div className="max-w-4xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, idx) => (
            <div key={idx} className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-white mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 核心功能 ── */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">为什么选择我们？</h2>
            <p className="text-gray-400">全方位深度分析，让投资决策更有把握</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature, idx) => (
              <div
                key={idx}
                className="p-6 bg-gray-900 border border-gray-800 rounded-2xl hover:border-gray-700 transition-colors"
              >
                <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400 mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                <p className="text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 定价方案 ── */}
      <section className="py-20 px-4 bg-gray-900/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">简单透明的定价</h2>
            <p className="text-gray-400">按需付费，没有隐藏费用</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {pricingPlans.map((plan, idx) => (
              <div
                key={idx}
                className={`p-6 rounded-2xl border ${
                  plan.highlighted
                    ? "bg-gradient-to-b from-blue-500/10 to-gray-900 border-blue-500/50"
                    : "bg-gray-900 border-gray-800"
                }`}
              >
                {plan.highlighted && (
                  <div className="text-xs text-blue-400 font-medium mb-2">
                    最受欢迎
                  </div>
                )}
                <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                <div className="mb-4">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-gray-500"> / {plan.quota}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-400">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate("/login")}
                  className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                    plan.highlighted
                      ? "bg-blue-600 hover:bg-blue-500"
                      : "bg-gray-800 hover:bg-gray-700"
                  }`}
                >
                  {plan.price === "免费" ? "开始使用" : "立即购买"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 用户见证 ── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">用户反馈</h2>
            <p className="text-gray-400">来自投资人和创业者的真实评价</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 bg-gray-900 border border-gray-800 rounded-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center font-bold">
                  T
                </div>
                <div>
                  <div className="font-medium">投资人 张先生</div>
                  <div className="text-xs text-gray-500">使用 2 个月</div>
                </div>
              </div>
              <p className="text-gray-400 text-sm">
                "用它分析了几十个 BP，估值虚高的项目一眼就能看出来，省了很多无效沟通的时间。"
              </p>
            </div>

            <div className="p-6 bg-gray-900 border border-gray-800 rounded-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-teal-500 rounded-full flex items-center justify-center font-bold">
                  L
                </div>
                <div>
                  <div className="font-medium">创业者 李女士</div>
                  <div className="text-xs text-gray-500">使用 1 个月</div>
                </div>
              </div>
              <p className="text-gray-400 text-sm">
                "融资前先用它自测了一下，发现了好几个数据漏洞，及时修正了 BP，融资成功率提高了不少。"
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">还在凭感觉判断项目？</h2>
          <p className="text-gray-400 mb-8">
            用数据说话，让投资决策更科学
          </p>
          <button
            onClick={() => navigate("/login")}
            className="px-10 py-4 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-400 hover:to-orange-400 rounded-xl font-bold text-lg transition-all transform hover:scale-105 inline-flex items-center gap-2"
          >
            <Zap className="w-5 h-5" />
            免费分析 3 次
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-800 py-8 text-center text-sm text-gray-600">
        <p>垃圾BP过滤机 v4.0 · MiniMax 知识库深度研究引擎</p>
        <p className="mt-1">Powered by MiniMax M2.5 DeepThink</p>
      </footer>
    </div>
  );
}
