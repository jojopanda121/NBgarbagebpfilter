import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import {
  FileText,
  Zap,
  Shield,
  BarChart3,
  Users,
  TrendingUp,
  Target,
  Brain,
  Lock,
  ChevronRight,
  Check,
  ArrowRight,
  Cpu,
  Database,
  Sparkles,
  Eye,
  AlertTriangle,
  TrendingDown,
  Globe,
  Award,
} from "lucide-react";

// 10维评分体系数据 - 强调AI大模型能力
const scoringDimensions = [
  { icon: Brain, title: "大模型智能分析", desc: "基于千亿参数大模型深度理解BP内容，提取关键信息" },
  { icon: BarChart3, title: "市场规模评估", desc: "TAM/SAM/SOM 精准分析，AI 识别市场数据真实性" },
  { icon: Users, title: "团队实力评估", desc: "大模型分析创始人背景、团队配置与股权结构" },
  { icon: TrendingUp, title: "商业模式诊断", desc: "AI 深度理解盈利模型，评估商业逻辑完整性" },
  { icon: Target, title: "竞争格局分析", desc: "全网数据检索，大模型对比竞争格局与护城河" },
  { icon: Zap, title: "增长潜力预测", desc: "AI 基于行业数据预测项目增长空间与扩张策略" },
  { icon: Shield, title: "合规风险扫描", desc: "大模型识别法律监管、知识产权与政策风险" },
  { icon: Lock, title: "数据安全审查", desc: "AI 评估数据隐私保护与安全合规水平" },
  { icon: Database, title: "财务健康诊断", desc: "智能分析财务数据，识别潜在财务风险" },
  { icon: Eye, title: "反Type I错误", desc: "AI 多维度交叉验证，最大程度规避低质量项目" },
];

// 核心优势数据
const advantages = [
  { icon: Sparkles, title: "千亿参数大模型", desc: "基于顶级大模型，理解能力接近人类投资专家" },
  { icon: AlertTriangle, title: "反Type I错误", desc: "多维度交叉验证，最大程度规避低质量项目" },
  { icon: Eye, title: "深度理解力", desc: "不只是关键词匹配，大模型真正理解BP的逻辑与潜力" },
  { icon: TrendingDown, title: "风险精准识别", desc: "AI 精准识别BP中的夸大表述与潜在风险点" },
];

// 使用流程数据 - 强调注册
const workflow = [
  { step: 1, title: "注册/登录", desc: "创建账号，开启您的智能尽职调查之旅" },
  { step: 2, title: "上传商业计划书", desc: "上传 PDF/DOCX 格式的BP，系统自动解析" },
  { step: 3, title: "获取AI分析报告", desc: "10维深度评估 + 风险提示 + 投资建议" },
];

// 统计数据
const stats = [
  { value: "50,000+", label: "已分析BP" },
  { value: "100,000+", label: "节省小时数" },
  { value: "90%", label: "噪声过滤率" },
];

function FadeIn({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// 导航栏组件
function GlassHeader({ onNavigate }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-slate-950/80 backdrop-blur-md border-b border-white/10"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">BP过滤机</span>
        </div>

        <nav className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">核心能力</a>
          <a href="#advantages" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">独特优势</a>
          <a href="#workflow" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">使用流程</a>
          <a href="#pricing" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">服务方案</a>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate("/login")}
            className="px-4 py-2 text-slate-300 hover:text-white text-sm font-medium transition-colors"
          >
            登录
          </button>
          <button
            onClick={() => onNavigate("/login")}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-all hover:shadow-lg hover:shadow-blue-500/25"
          >
            免费注册
          </button>
        </div>
      </div>
    </header>
  );
}

// 动态背景组件
function ParticleBackground() {
  const [init, setInit] = useState(false);

  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => {
      setInit(true);
    });
  }, []);

  return (
    init && (
      <Particles
        id="tsparticles"
        className="absolute inset-0"
        options={{
          background: { color: { value: "transparent" } },
          fpsLimit: 120,
          interactivity: {
            events: {
              onHover: { enable: true, mode: "grab" },
              onClick: { enable: true, mode: "push" },
            },
            modes: {
              grab: { distance: 140, links: { opacity: 0.5 } },
              push: { quantity: 4 },
            },
          },
          particles: {
            color: { value: "#3B82F6" },
            links: {
              color: "#3B82F6",
              distance: 150,
              enable: true,
              opacity: 0.2,
              width: 1,
            },
            move: {
              direction: "none",
              enable: true,
              outModes: { default: "bounce" },
              random: false,
              speed: 1,
              straight: false,
            },
            number: { density: { enable: true, area: 800 }, value: 60 },
            opacity: { value: 0.3 },
            shape: { type: "circle" },
            size: { value: { min: 1, max: 3 } },
          },
          detectRetina: true,
        }}
      />
    )
  );
}

// Hero 区域 - 强调注册登录
function HeroSection({ onNavigate }) {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-slate-950">
      {/* 动态背景 */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />
        <ParticleBackground />
        {/* 渐变叠加 */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-32 text-center">
        <FadeIn>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm mb-8">
            <Sparkles className="w-4 h-4" />
            <span>AI 大模型驱动的智能尽职调查</span>
          </div>
        </FadeIn>

        {/* 名言引用 */}
        <FadeIn delay={0.05}>
          <blockquote className="max-w-3xl mx-auto mb-10">
            <p className="text-2xl md:text-3xl font-serif text-white/90 leading-relaxed italic">
              "伟大的投资不在于做对了多少极其困难的事，
              <br className="hidden md:block" />
              而在于避开了多少显而易见的愚蠢。"
            </p>
          </blockquote>
        </FadeIn>

        <FadeIn delay={0.1}>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight leading-tight">
            不再错过
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              任何优质项目
            </span>
          </h1>
        </FadeIn>

        <FadeIn delay={0.2}>
          <p className="text-xl text-slate-400 mb-6 max-w-2xl mx-auto leading-relaxed">
            基于千亿参数大模型，深度理解商业计划书内容
            <br />
            <span className="text-slate-500">10维全面评估，最大程度规避低质量项目</span>
          </p>
        </FadeIn>

        <FadeIn delay={0.3}>
          <p className="text-lg text-blue-400 mb-10 font-medium">
            点击下方注册账号，免费体验AI智能分析
          </p>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <button
              onClick={() => onNavigate("/login")}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-all hover:shadow-lg hover:shadow-blue-500/25 flex items-center gap-2"
            >
              免费注册
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => onNavigate("/login")}
              className="px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg transition-all border border-white/10"
            >
              已有账号登录
            </button>
          </div>
        </FadeIn>

        <FadeIn delay={0.5}>
          <div className="flex flex-wrap items-center justify-center gap-6 text-slate-500">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-sm">千亿参数大模型</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-sm">10维深度评估</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-sm">反Type I错误</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-sm">数据隐私保护</span>
            </div>
          </div>
        </FadeIn>
      </div>

      {/* 向下滚动指示器 */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <ChevronRight className="w-6 h-6 text-slate-600 rotate-90" />
      </motion.div>
    </section>
  );
}

// 统计数据区域
function StatsSection() {
  return (
    <section className="py-16 bg-slate-950 border-y border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {stats.map((stat, idx) => (
            <FadeIn key={idx} delay={idx * 0.1}>
              <div className="text-center">
                <div className="text-4xl md:text-5xl font-bold text-white mb-2">{stat.value}</div>
                <div className="text-slate-400 text-sm">{stat.label}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// 功能卡片组件
function FeatureCard({ icon: Icon, title, desc, index }) {
  return (
    <FadeIn delay={index * 0.05} className="group">
      <div className="p-6 rounded-xl bg-slate-900/50 border border-white/5 hover:border-blue-500/30 transition-all duration-300 hover:bg-slate-800/50">
        <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4 group-hover:bg-blue-500/20 transition-colors">
          <Icon className="w-6 h-6 text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
      </div>
    </FadeIn>
  );
}

// 核心功能区域 - 强调AI大模型
function FeaturesSection() {
  return (
    <section id="features" className="py-24 bg-slate-950">
      <div className="max-w-7xl mx-auto px-6">
        <FadeIn>
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">AI 大模型深度评估体系</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              基于顶级千亿参数大模型，不只是关键词匹配，而是真正理解商业逻辑
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {scoringDimensions.map((item, idx) => (
            <FeatureCard key={idx} {...item} index={idx} />
          ))}
        </div>
      </div>
    </section>
  );
}

// 独特优势区域 - 强调反Type I错误
function AdvantagesSection() {
  return (
    <section id="advantages" className="py-24 bg-slate-900">
      <div className="max-w-7xl mx-auto px-6">
        <FadeIn>
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">为什么选择我们</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              专为投资人打造的AI尽调工具，解决传统方法的核心痛点
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {advantages.map((item, idx) => (
            <FadeIn key={idx} delay={idx * 0.1}>
              <div className="p-6 rounded-xl bg-slate-800/50 border border-white/5 hover:border-blue-500/30 transition-all duration-300">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-4">
                  <item.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Type I 错误详细说明 */}
        <FadeIn delay={0.3}>
          <div className="mt-16 p-8 rounded-2xl bg-gradient-to-r from-blue-900/30 to-indigo-900/30 border border-blue-500/20">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-8 h-8 text-blue-400" />
              </div>
              <div className="text-center md:text-left">
                <h3 className="text-xl font-bold text-white mb-2">什么是 Type I 错误？为什么它很重要？</h3>
                <p className="text-slate-400 leading-relaxed">
                  在投资中，Type I 错误意味着「错误地拒绝好项目」，即将优质项目误判为低质量。传统BP分析依赖人工审核或简单关键词匹配，
                  容易因表面缺陷而错失具有潜力的优质项目。我们的AI大模型通过多维度交叉验证和深度理解能力，
                  最大限度降低误判率，帮助投资人更准确地识别真正有价值的投资机会。
                </p>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// 使用流程区域
function WorkflowSection() {
  return (
    <section id="workflow" className="py-24 bg-slate-950">
      <div className="max-w-7xl mx-auto px-6">
        <FadeIn>
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">三步开启智能尽调</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              简单流程，立即开始AI驱动的尽职调查
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {workflow.map((item, idx) => (
            <FadeIn key={idx} delay={idx * 0.2}>
              <div className="relative">
                {/* 连接线 */}
                {idx < workflow.length - 1 && (
                  <div className="hidden md:block absolute top-12 left-1/2 w-full h-0.5 bg-gradient-to-r from-blue-500 to-transparent opacity-30" />
                )}

                <div className="relative text-center">
                  <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-white/10" />
                    <span className="text-4xl font-bold text-white">{item.step}</span>
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-slate-400 text-sm">{item.desc}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// 服务方案区域
function PricingSection({ onNavigate }) {
  return (
    <section id="pricing" className="py-24 bg-slate-900">
      <div className="max-w-7xl mx-auto px-6">
        <FadeIn>
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">灵活的服务方案</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              根据您的需求选择合适的套餐，支持企业定制
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* 免费版 */}
          <FadeIn delay={0.1}>
            <div className="p-8 rounded-2xl bg-slate-800/50 border border-white/10">
              <h3 className="text-xl font-semibold text-white mb-2">免费版</h3>
              <p className="text-3xl font-bold text-white mb-4">¥0<span className="text-slate-400 text-sm font-normal">/月</span></p>
              <p className="text-slate-400 text-sm mb-6">适合个人投资人初步体验</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  每月 5 次BP分析
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  10维基础评估
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  风险提示
                </li>
              </ul>
              <button
                onClick={() => onNavigate("/login")}
                className="block w-full py-3 text-center bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                免费注册
              </button>
            </div>
          </FadeIn>

          {/* 专业版 - 推荐 */}
          <FadeIn delay={0.2}>
            <div className="p-8 rounded-2xl bg-gradient-to-b from-blue-900/30 to-indigo-900/30 border-2 border-blue-500 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-blue-500 text-white text-xs font-semibold rounded-full">
                推荐
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">专业版</h3>
              <p className="text-3xl font-bold text-white mb-4">¥999<span className="text-slate-400 text-sm font-normal">/月</span></p>
              <p className="text-slate-400 text-sm mb-6">适合专业投资机构</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  无限次BP分析
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  10维深度评估
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  反Type I错误增强
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  投资建议报告
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  优先客服支持
                </li>
              </ul>
              <button
                onClick={() => onNavigate("/login")}
                className="block w-full py-3 text-center bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                立即升级
              </button>
            </div>
          </FadeIn>

          {/* 企业版 */}
          <FadeIn delay={0.3}>
            <div className="p-8 rounded-2xl bg-slate-800/50 border border-white/10">
              <h3 className="text-xl font-semibold text-white mb-2">企业版</h3>
              <p className="text-3xl font-bold text-white mb-4">联系我们</p>
              <p className="text-slate-400 text-sm mb-6">适合投资机构与FA团队</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  专属大模型定制
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  API 接口对接
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  团队协作管理
                </li>
                <li className="flex items-center gap-2 text-slate-300 text-sm">
                  <Check className="w-4 h-4 text-emerald-500" />
                  7x24专属支持
                </li>
              </ul>
              <button
                onClick={() => onNavigate("/login")}
                className="block w-full py-3 text-center bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                联系我们
              </button>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// CTA 区域
function CTASection({ onNavigate }) {
  return (
    <section className="py-24 bg-gradient-to-b from-slate-950 to-slate-900">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <FadeIn>
          <h2 className="text-4xl font-bold text-white mb-6">
            让AI成为您的尽职调查助手
          </h2>
          <p className="text-slate-400 mb-8 max-w-2xl mx-auto">
            注册即可获得免费体验次数，让大模型帮助您发现更多优质项目
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => onNavigate("/login")}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-all hover:shadow-lg hover:shadow-blue-500/25 flex items-center gap-2"
            >
              免费注册体验
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// 页脚
function Footer() {
  return (
    <footer className="py-12 bg-slate-950 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-semibold text-white">BP过滤机</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="#features" className="text-slate-400 hover:text-white transition-colors text-sm">
              核心能力
            </a>
            <a href="#advantages" className="text-slate-400 hover:text-white transition-colors text-sm">
              独特优势
            </a>
            <a href="#pricing" className="text-slate-400 hover:text-white transition-colors text-sm">
              服务方案
            </a>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-white/5 text-center">
          <p className="text-slate-500 text-sm">
            © 2026 BP过滤机. 基于千亿参数大模型的商业计划书智能分析服务。
          </p>
        </div>
      </div>
    </footer>
  );
}

// 主Landing页面组件
export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950">
      <GlassHeader onNavigate={navigate} />
      <HeroSection onNavigate={navigate} />
      <StatsSection />
      <FeaturesSection />
      <AdvantagesSection />
      <WorkflowSection />
      <PricingSection onNavigate={navigate} />
      <CTASection onNavigate={navigate} />
      <Footer />
    </div>
  );
}
