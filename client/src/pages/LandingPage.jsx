import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

/**
 * LandingPage — PitchBook 风格亮色金融主题
 * 设计 by Claude Design (claude.ai/design)
 *
 * 核心元素：
 *  - 暖白底 + 深海军蓝 + 宝蓝品牌色
 *  - 衬线体（Noto Serif SC）标题 + 等宽（JetBrains Mono）数据
 *  - Hero 右侧产品面板 mockup（macOS 窗口 chrome + 5维 + 声明核查 + Pipeline）
 *  - 动态神经网络背景（canvas）
 *  - Logo E（神经网络 + 过滤条 + 金色中心节点）
 */

const LogoE = ({ size = 32, rounded = 6 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="40" height="40" rx={rounded} fill="#1B4FD8" />
    <circle cx="10" cy="10" r="4.5" fill="white" opacity="0.2" />
    <circle cx="30" cy="10" r="4.5" fill="white" opacity="0.2" />
    <circle cx="10" cy="30" r="4.5" fill="white" opacity="0.2" />
    <circle cx="30" cy="30" r="4.5" fill="white" opacity="0.2" />
    <line x1="10" y1="10" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <line x1="30" y1="10" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <line x1="10" y1="30" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <line x1="30" y1="30" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <rect x="5" y="6.5" width="30" height="3.5" rx="1.75" fill="white" opacity="0.88" />
    <rect x="8" y="18" width="24" height="3.5" rx="1.75" fill="white" opacity="0.88" />
    <rect x="12" y="29.5" width="16" height="3.5" rx="1.75" fill="white" opacity="0.88" />
    <circle cx="20" cy="20" r="3" fill="#C9A84C" />
  </svg>
);

// ── 动态神经网络背景 canvas ─────────────────────────
function BgCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W, H, nodes, animId;
    const NAVY = "13,33,69";
    const BLUE = "27,79,216";

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    const makeNodes = (n) =>
      Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.8 + 0.6,
        pulse: Math.random() * Math.PI * 2,
      }));

    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);

      const grad = ctx.createRadialGradient(W * 0.72, H * 0.18, 0, W * 0.72, H * 0.18, W * 0.55);
      grad.addColorStop(0, `rgba(${BLUE},0.055)`);
      grad.addColorStop(1, `rgba(${BLUE},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      const grad2 = ctx.createRadialGradient(W * 0.1, H * 0.75, 0, W * 0.1, H * 0.75, W * 0.4);
      grad2.addColorStop(0, `rgba(${NAVY},0.04)`);
      grad2.addColorStop(1, `rgba(${NAVY},0)`);
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, W, H);

      nodes.forEach((nd) => {
        nd.x += nd.vx;
        nd.y += nd.vy;
        nd.pulse += 0.012;
        if (nd.x < 0 || nd.x > W) nd.vx *= -1;
        if (nd.y < 0 || nd.y > H) nd.vy *= -1;
      });

      const LINK = Math.min(W, H) * 0.14;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK) {
            const a = (1 - d / LINK) * 0.1;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(${BLUE},${a})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      nodes.forEach((nd) => {
        const p = Math.sin(nd.pulse) * 0.3 + 0.7;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, nd.r * p, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${BLUE},${0.18 * p})`;
        ctx.fill();
      });

      // 扫描线
      const lineCount = 6;
      for (let i = 0; i < lineCount; i++) {
        const y = ((t * 0.018 + i / lineCount) % 1) * H;
        const lg = ctx.createLinearGradient(0, y, W, y);
        lg.addColorStop(0, `rgba(${BLUE},0)`);
        lg.addColorStop(0.5, `rgba(${BLUE},0.028)`);
        lg.addColorStop(1, `rgba(${BLUE},0)`);
        ctx.fillStyle = lg;
        ctx.fillRect(0, y, W, 1.5);
      }

      animId = requestAnimationFrame(draw);
    };

    resize();
    nodes = makeNodes(55);
    animId = requestAnimationFrame(draw);
    const onResize = () => {
      resize();
      nodes = makeNodes(55);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}

// ── 滚动揭示动画 hook ─────────────────────────
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".lp-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// ── Section 内容数据 ─────────────────────────
const FEATURES = [
  { num: "01", title: "5维量化评分模型", desc: "告别「拍脑袋打分」。AI 输出严谨枚举值与绝对数值，JS 端执行纯数学计算，每维度有独立公式与业务逻辑，结果完全可追溯。", emHigh: ["严谨枚举值与绝对数值"] },
  { num: "02", title: "声明逐条核查", desc: "针对 BP 中每条关键声明，AI 扮演行业专家 + 投资专家进行辩证研究，输出「诚实 / 存疑 / 夸大 / 证伪」结论，直接反映 BP 诚信度评分。", emHigh: ["行业专家 + 投资专家"] },
  { num: "03", title: "尽调问卷（DD）", desc: "一键启动 AI 生成定制化尽调问卷，完成后自动重新评分，体现尽调信息对综合判断的校正。Pipeline 状态同步更新。", emHigh: ["AI 生成定制化尽调问卷"] },
  { num: "04", title: "多 Agent 工作区", desc: "每个项目有独立工作区，支持与多个专业 Agent 对话——市场分析、财务模型、竞品研究、风险评估，随时调出深度分析。", emHigh: ["多个专业 Agent 对话"] },
  { num: "05", title: "投资备忘录生成", desc: "一键输出符合机构投委会标准的结构化投资备忘录（IMemo），包含项目摘要、风险矩阵、尽调结论，可直接归档或分享。", emHigh: ["机构投委会标准"] },
  { num: "06", title: "Pipeline 投资流程管理", desc: "从 新建 → 评估 → 尽调 → 决策 → 投资/否决，完整的项目生命周期管理。支持标签、跟进日期提醒、省份地图分布可视化。", emHigh: ["新建 → 评估 → 尽调 → 决策 → 投资/否决"] },
];

const DIM5 = [
  { wt: "维度一", name: "时机与天花板", sub: "AI 主动检索细分赛道的真实市场规模与增速，不采信 BP 自称数据，给出独立判断。", formula: "市场规模 · 行业增速\n赛道成熟度" },
  { wt: "维度二", name: "产品与壁垒", sub: "交叉比对行业真实竞品，客观评估技术成熟度与差异化壁垒深度。", formula: "技术就绪度 · 竞品排名\n护城河强度" },
  { wt: "维度三", name: "资本效率与规模效应", sub: "基于顶级 VC 研究框架评估赛道商业属性，早期项目同样适用。", formula: "轻重资产结构 · 边际成本\n网络效应潜力" },
  { wt: "维度四", name: "团队基因", sub: "多因子综合评估创始团队，经验深度、行业匹配度、团队完整性缺一不可。", formula: "行业经验 · 赛道匹配\n过往战绩 · 团队结构" },
  { wt: "维度五", name: "BP 诚信度", sub: "AI 逐条核查 BP 中的关键声明，识别夸大、包装与事实性错误，量化可信程度。", formula: "声明核查 · 数据溯源\n一致性验证" },
];

const PIPELINE = [
  { n: "01", l: "新建", d: "BP 上传完成，自动创建项目", done: true },
  { n: "02", l: "已评估", d: "查阅报告后自动标记", done: true },
  { n: "03", l: "待尽调", d: "标记值得深入的项目", done: true },
  { n: "04", l: "尽调中", d: "AI 生成问卷，逐条填写", done: false },
  { n: "05", l: "尽调完成", d: "评分自动校正，IMemo 生成", done: false },
  { n: "06", l: "已决策", d: "投委会审议结论记录", done: false },
  { n: "07", l: "已投资 / 已否决", d: "归档，供日后复盘参考", done: false },
];

const WORKFLOW = [
  { n: "01", t: "注册 · 上传 BP", d: "支持 PDF/DOCX，绑定邮箱后即可上传。支持文字版与扫描版 PDF，最大提取 30,000 字符。" },
  { n: "02", t: "AI 深度解析", d: "顶级大模型扮演行业专家 + 投资专家，逐条核查声明真实性，输出 5 维度量化数据，3 分钟完成。支持多模型选择。" },
  { n: "03", t: "获取评分报告", d: "查看量化评分、声明核查结果、评级（A/B/C/D）与行动建议。可一键启动尽调问卷深入评估。" },
  { n: "04", t: "Pipeline 跟进", d: "项目自动进入 Pipeline，生成 IMemo，标注阶段与标签，设置跟进日期，与团队分享报告。" },
];

const GRADES = [
  { g: "A", cls: "bg-[#F0FDF4] text-[#15803D]", range: "≥ 85", verdict: "强烈推荐 Fast Track", vc: "text-[#15803D]", action: "24小时内约见创始人，立即启动尽调" },
  { g: "B", cls: "bg-[rgba(27,79,216,0.08)] text-[#1B4FD8]", range: "70–84", verdict: "谨慎推荐 Proceed DD", vc: "text-[#1B4FD8]", action: "安排面谈，验证单位经济模型" },
  { g: "C", cls: "bg-[#FFFBEB] text-[#B45309]", range: "60–69", verdict: "观望跟踪 Keep In View", vc: "text-[#B45309]", action: "季度跟踪，关注关键里程碑达成" },
  { g: "D", cls: "bg-[#FEF2F2] text-[#B91C1C]", range: "< 60", verdict: "建议放弃 Reject", vc: "text-[#B91C1C]", action: "归档并标注否决原因，供投委会复盘" },
];

// ── Main page ─────────────────────────
export default function LandingPage() {
  const navigate = useNavigate();
  useReveal();

  const goSignup = () => navigate("/login");
  const goDemo = () => navigate("/demo");

  return (
    <div className="bg-[#F6F7FA] text-[#0F1C36]" style={{ fontFamily: "var(--sans)" }}>
      <BgCanvas />

      {/* ── NAV ── */}
      <nav className="fixed top-0 inset-x-0 z-50 h-[60px] flex items-center px-6 md:px-12 bg-[#F6F7FA]/95 backdrop-blur-md border-b border-[#D8DCE8]">
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex items-center gap-2.5 shrink-0"
        >
          <LogoE size={32} />
          <span className="font-serif-cn font-bold text-[15px] tracking-wide text-[#0D2145]">BP过滤机</span>
        </a>
        <div className="flex-1 hidden md:flex justify-center gap-9">
          {[
            ["核心功能", "#features"],
            ["评分体系", "#dimensions"],
            ["投资流程", "#pipeline"],
            ["定价", "#pricing"],
          ].map(([t, h]) => (
            <a key={h} href={h} className="text-[13.5px] text-[#4B5A72] hover:text-[#0D2145] transition-colors">{t}</a>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <button onClick={goSignup} className="text-[13.5px] text-[#4B5A72] hover:text-[#0D2145] py-1.5">登录</button>
          <button onClick={goSignup} className="text-[13px] font-semibold text-white bg-[#1B4FD8] hover:bg-[#163069] px-5 py-2.5 rounded-[3px] transition-colors">
            免费注册
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative z-10 min-h-screen flex items-center px-6 md:px-12 pt-[100px] pb-[72px] overflow-hidden">
        <div className="absolute -top-[100px] -right-[60px] w-[700px] h-[700px] pointer-events-none"
             style={{ background: "radial-gradient(ellipse, rgba(27,79,216,.09) 0%, transparent 65%)" }} />
        <div className="absolute -bottom-[80px] -left-[80px] w-[400px] h-[400px] pointer-events-none"
             style={{ background: "radial-gradient(ellipse, rgba(13,33,69,.05) 0%, transparent 65%)" }} />

        <div className="max-w-[1280px] mx-auto w-full grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <div>
            <div className="inline-flex items-center gap-2 lp-fade font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase bg-[rgba(27,79,216,.07)] border border-[rgba(27,79,216,.2)] px-3 py-1 rounded-[2px] mb-5"
                 style={{ animationDelay: ".1s" }}>
              The AI Workspace for VC &amp; PE
            </div>
            <h1 className="font-serif-cn text-[clamp(40px,4.5vw,66px)] font-bold leading-[1.1] tracking-tight text-[#0D2145] mb-4 lp-fade"
                style={{ animationDelay: ".2s" }}>
              让每一个投资判断<br />
              <em className="not-italic text-[#1B4FD8]">有据可依</em>
            </h1>
            <p className="text-[16px] text-[#4B5A72] leading-[1.75] max-w-[480px] mb-8 lp-fade"
               style={{ animationDelay: ".3s" }}>
              专为一级市场投资人打造的智能工作台。独创量化评分体系精准评估每份 BP，AI 逐条击破虚假陈述，多 Agent 协同覆盖分析、尽调、投资备忘录全链路。<br />
              <strong className="text-[#0D2145] font-semibold">把繁琐留给 AI，把判断留给自己。</strong>
            </p>
            <div className="flex flex-wrap gap-3 items-center mb-9 lp-fade" style={{ animationDelay: ".4s" }}>
              <button onClick={goSignup} className="text-[14px] font-semibold text-white bg-[#1B4FD8] hover:bg-[#163069] px-7 py-3 rounded-[3px] transition-colors">
                免费开始使用 →
              </button>
              <button onClick={goDemo} className="text-[14px] font-medium text-[#0D2145] bg-transparent border-[1.5px] border-[#0D2145] hover:bg-[#0D2145] hover:text-white px-7 py-3 rounded-[3px] transition-all">
                查看演示报告
              </button>
            </div>
            <div className="flex flex-wrap gap-5 items-center lp-fade" style={{ animationDelay: ".5s" }}>
              {["独创量化评分体系", "虚假陈述逐条击破", "多模型按需切换"].map((t) => (
                <div key={t} className="flex items-center gap-1.5 text-[12px] text-[#8E9BB0]">
                  <div className="w-4 h-4 rounded-full bg-[#F0FDF4] border border-[rgba(21,128,61,.2)] flex items-center justify-center text-[9px] text-[#15803D] shrink-0">✓</div>
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* 产品面板 mockup */}
          <div className="lp-panel-in relative">
            <div className="bg-[#0D2145] rounded-t-[6px] px-4 py-2.5 flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full opacity-55" style={{ background: "#FF5F57" }} />
              <div className="w-2.5 h-2.5 rounded-full opacity-55" style={{ background: "#FEBC2E" }} />
              <div className="w-2.5 h-2.5 rounded-full opacity-55" style={{ background: "#28C840" }} />
              <span className="font-mono-fin text-[11px] text-white/40 tracking-wider ml-2">BP过滤机 · Project Detail</span>
            </div>
            <div className="bg-white border border-[#D8DCE8] border-t-0 rounded-b-[6px] overflow-hidden"
                 style={{ boxShadow: "0 16px 56px rgba(13,33,69,.12), 0 2px 8px rgba(13,33,69,.06)" }}>
              <div className="flex border-b border-[#D8DCE8] bg-[#F6F7FA]">
                {[["分析报告", true], ["工作区", false], ["尽调问卷", false], ["投资备忘录", false], ["项目备注", false]].map(([t, active]) => (
                  <div key={t} className={`font-mono-fin text-[10.5px] tracking-wider px-4 py-2.5 cursor-default border-b-2 -mb-px ${active ? "text-[#1B4FD8] border-[#1B4FD8]" : "text-[#8E9BB0] border-transparent"}`}>
                    {t}
                  </div>
                ))}
              </div>
              <div className="p-5">
                <div className="mb-3.5">
                  <div className="font-serif-cn text-[17px] font-bold text-[#0D2145] mb-0.5">某智能制造 SaaS</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono-fin text-[10px] text-[#8E9BB0]">BP-2024-0087</span>
                    <span className="text-[11px] text-[#4B5A72]">Pre-A · 3,000 万人民币</span>
                    <div className="flex gap-1">
                      <span className="font-mono-fin text-[9.5px] tracking-wider px-2 py-0.5 rounded-[2px] border bg-[#F0FDF4] text-[#15803D] border-[rgba(21,128,61,.2)]">已评估</span>
                      <span className="font-mono-fin text-[9.5px] tracking-wider px-2 py-0.5 rounded-[2px] border bg-[rgba(27,79,216,.07)] text-[#1B4FD8] border-[rgba(27,79,216,.2)]">尽调中</span>
                      <span className="font-mono-fin text-[9.5px] tracking-wider px-2 py-0.5 rounded-[2px] border bg-[#EEF1F7] text-[#8E9BB0] border-[#D8DCE8]">已决策</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-end gap-4 pb-4 mb-4 border-b border-[#D8DCE8]">
                  <div className="font-mono-fin text-[52px] font-medium leading-none text-[#B45309]">
                    67<sub className="text-[18px] text-[#8E9BB0]">/100</sub>
                  </div>
                  <div className="flex-1">
                    <div className="font-mono-fin text-[10px] tracking-wider text-[#8E9BB0] uppercase mb-1.5">综合评分 · Overall Score</div>
                    <span className="inline-block font-mono-fin text-[11px] font-medium tracking-wider px-2.5 py-1 rounded-[2px] text-[#B45309] bg-[#FFFBEB] border border-[rgba(180,83,9,.2)]">B — 谨慎推荐</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  {[
                    ["时机与天花板", 78, "hi"],
                    ["产品与壁垒", 62, "mid"],
                    ["资本效率", 70, "mid"],
                    ["团队基因", 74, "hi"],
                    ["BP诚信度", 32, "lo"],
                  ].map(([n, s, lvl]) => (
                    <div key={n} className="grid items-center gap-2.5" style={{ gridTemplateColumns: "90px 1fr 30px" }}>
                      <span className="font-mono-fin text-[11px] text-[#4B5A72]">{n}</span>
                      <div className="h-1 bg-[#EEF1F7] rounded-[2px] overflow-hidden">
                        <div className="h-full rounded-[2px] transition-all" style={{
                          width: `${s}%`,
                          background: lvl === "hi" ? "#15803D" : lvl === "lo" ? "#B91C1C" : "#1B4FD8"
                        }} />
                      </div>
                      <span className="font-mono-fin text-[11px] text-[#8E9BB0] text-right">{s}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[#D8DCE8] pt-3.5">
                  <div className="font-mono-fin text-[10px] tracking-wider text-[#8E9BB0] uppercase mb-2">声明核查 · Claim Verification</div>
                  {[
                    ["bad", "「全球 TAM 超 5,000 亿」— 核查：严重夸大，细分市场仅 200 亿"],
                    ["bad", "「独家专利技术」— 核查：专利申请中，尚未授权"],
                    ["ok", "「已签约 3 家 500 强客户」— 核查：信息属实"],
                  ].map(([k, t], i) => (
                    <div key={i} className="flex items-start gap-2 mb-1.5">
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 ${k === "bad" ? "text-[#B91C1C] bg-[#FEF2F2]" : "text-[#15803D] bg-[#F0FDF4]"}`}>
                        {k === "bad" ? "✗" : "✓"}
                      </span>
                      <span className="text-[12px] text-[#4B5A72] leading-[1.5]">{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── METRICS ── */}
      <div className="relative z-10 bg-[#0D2145] grid grid-cols-2 md:grid-cols-4">
        {[
          ["5", "", "维度量化评分，每维度独立建模，数学公式驱动"],
          ["< 3", " min", "单份 BP 分析完成，传统人工需要 2–4 小时"],
          ["90", "%", "噪声过滤率，帮助投资人聚焦有价值的项目"],
          ["50,000", "+", "已分析 BP 数量，持续迭代行业专属模型"],
        ].map(([n, em, d], i) => (
          <div key={i} className="px-8 md:px-12 py-9 border-r border-white/10 last:border-r-0">
            <div className="font-mono-fin text-[38px] font-medium text-white leading-none mb-2">
              {n}<em className="not-italic text-[19px] text-white/40">{em}</em>
            </div>
            <div className="text-[13px] text-white/50 leading-[1.5] max-w-[200px]">{d}</div>
          </div>
        ))}
      </div>

      {/* ── FEATURES ── */}
      <section id="features" className="relative z-10 py-20 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase flex items-center gap-2.5 mb-3.5">
            <span className="block w-4 h-0.5 bg-[#1B4FD8] rounded-sm" />核心功能 · Core Features
          </div>
          <h2 className="font-serif-cn text-[clamp(26px,2.7vw,40px)] font-bold leading-[1.2] text-[#0D2145] max-w-[520px] mb-12">
            从 BP 上传到投资决策，全流程 AI 辅助
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#D8DCE8] border border-[#D8DCE8] rounded-[4px] overflow-hidden lp-reveal">
            {FEATURES.map((f) => (
              <div key={f.num} className="bg-white p-9 hover:bg-[#EFF3FF] transition-colors">
                <div className="font-mono-fin text-[11px] text-[#1B4FD8] tracking-[.1em] mb-3.5 opacity-60">{f.num}</div>
                <div className="font-serif-cn text-[17px] font-bold text-[#0D2145] mb-2 leading-tight">{f.title}</div>
                <div className="text-[13px] text-[#4B5A72] leading-[1.75]">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5 DIMENSIONS ── */}
      <section id="dimensions" className="relative z-10 py-20 px-6 md:px-12 bg-[#EEF1F7] border-y border-[#D8DCE8]">
        <div className="max-w-[1280px] mx-auto">
          <div className="font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase flex items-center gap-2.5 mb-3.5">
            <span className="block w-4 h-0.5 bg-[#1B4FD8] rounded-sm" />评分体系 · Scoring Dimensions
          </div>
          <h2 className="font-serif-cn text-[clamp(26px,2.7vw,40px)] font-bold leading-[1.2] text-[#0D2145] max-w-[600px] mb-12">
            五大维度全面评估，量化替代直觉，结果有据可查
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 lp-reveal">
            {DIM5.map((d) => (
              <div key={d.wt}
                   className="relative overflow-hidden bg-white border border-[#D8DCE8] rounded-[4px] p-6 transition-all hover:border-[#1B4FD8] hover:shadow-[0_6px_24px_rgba(27,79,216,0.1)] group">
                <div className="absolute top-0 inset-x-0 h-[3px] bg-[#1B4FD8] origin-left scale-x-0 group-hover:scale-x-100 transition-transform" />
                <div className="font-mono-fin text-[10px] tracking-wider text-[#1B4FD8] mb-3 opacity-70">{d.wt}</div>
                <div className="font-serif-cn text-[15px] font-bold text-[#0D2145] mb-2">{d.name}</div>
                <div className="text-[11.5px] text-[#4B5A72] leading-[1.6] mb-3">{d.sub}</div>
                <div className="font-mono-fin text-[10px] text-[#8E9BB0] bg-[#EEF1F7] px-2 py-1.5 rounded-[2px] leading-[1.5] whitespace-pre-line">{d.formula}</div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-10 mt-14 lp-reveal">
            <div>
              <div className="font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase flex items-center gap-2.5 mb-3.5">
                <span className="block w-4 h-0.5 bg-[#1B4FD8] rounded-sm" />评级体系 · Grading
              </div>
              <table className="w-full">
                <thead>
                  <tr>
                    {["评级", "分数区间", "结论", "行动建议"].map((h) => (
                      <th key={h} className="font-mono-fin text-[10px] tracking-wider text-[#8E9BB0] uppercase text-left py-2 px-3.5 border-b-2 border-[#D8DCE8]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GRADES.map((g) => (
                    <tr key={g.g}>
                      <td className="py-3 px-3.5 border-b border-[#D8DCE8]">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-mono-fin text-[14px] font-bold ${g.cls}`}>{g.g}</span>
                      </td>
                      <td className="py-3 px-3.5 border-b border-[#D8DCE8] font-mono-fin text-[12px]">{g.range}</td>
                      <td className={`py-3 px-3.5 border-b border-[#D8DCE8] text-[13px] font-semibold ${g.vc}`}>{g.verdict}</td>
                      <td className="py-3 px-3.5 border-b border-[#D8DCE8] text-[12px] text-[#4B5A72] leading-[1.55]">{g.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase flex items-center gap-2.5 mb-3.5">
                <span className="block w-4 h-0.5 bg-[#1B4FD8] rounded-sm" />为什么不一样 · Why It's Different
              </div>
              <div className="flex flex-col gap-4">
                {[
                  ["客观，而非依赖大模型感觉", "市面上大多数 AI 分析工具让模型直接「给个评分」。我们不同——AI 只负责检索与分类，评分由独立的量化模型计算，结论有据可查，不受模型幻觉影响。"],
                  ["不错杀潜力项目", "我们的模型专为早期项目优化。即使 BP 信息不完整，也不会因此重度惩罚评分。对于信息存疑的声明，系统给予中性处理，只有确凿的夸大才会影响结论。"],
                  ["垂直赛道同样适用", "评分体系专为中国新兴赛道校准，不用旧时代「百亿市场」的标准误杀精品垂直项目。具身智能、低空经济、合成生物——每个赛道都能得到公平评估。"],
                ].map(([t, d]) => (
                  <div key={t} className="bg-white border border-[#D8DCE8] p-5 rounded-[3px]">
                    <div className="font-serif-cn text-[14px] font-bold text-[#0D2145] mb-1.5">{t}</div>
                    <div className="text-[13px] text-[#4B5A72] leading-[1.65]">{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PIPELINE ── */}
      <section id="pipeline" className="relative z-10 py-20 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase flex items-center gap-2.5 mb-3.5">
            <span className="block w-4 h-0.5 bg-[#1B4FD8] rounded-sm" />投资流程 · Deal Pipeline
          </div>
          <h2 className="font-serif-cn text-[clamp(26px,2.7vw,40px)] font-bold leading-[1.2] text-[#0D2145] max-w-[520px] mb-12">
            从 BP 到投资决策，7 阶段全程追踪
          </h2>

          <div className="relative lp-reveal">
            <div className="hidden lg:block absolute top-[26px] left-[26px] right-[26px] h-px"
                 style={{ background: "linear-gradient(to right, #1B4FD8, #D8DCE8 80%)" }} />
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-5 relative">
              {PIPELINE.map((p) => (
                <div key={p.n} className="text-center">
                  <div className={`w-[52px] h-[52px] rounded-full flex items-center justify-center mx-auto mb-4 relative z-10 border-2 border-[#1B4FD8] ${p.done ? "bg-[#1B4FD8]" : "bg-white"}`}>
                    <span className={`font-mono-fin text-[13px] font-medium ${p.done ? "text-white" : "text-[#1B4FD8]"}`}>{p.n}</span>
                  </div>
                  <div className="font-serif-cn text-[12px] font-bold text-[#0D2145] mb-1">{p.l}</div>
                  <div className="text-[11px] text-[#4B5A72] leading-[1.5]">{p.d}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mt-14 lp-reveal">
            {[
              ["SHARE", "报告分享", "生成 3 天有效分享链接，报告可对外分享，附邀请码追踪。"],
              ["GEO", "地理分布看板", "中国省份地图可视化，一眼看清项目地理集中度与覆盖范围。"],
              ["STATS", "个人数据看板", "6个月趋势折线图、评级分布饼图、赛道分布，量化你的投资视野。"],
              ["RANK", "排行榜", "与其他投资人比较分析数量与平均评分，发现行业热度趋势。"],
            ].map(([k, t, d]) => (
              <div key={k} className="bg-white border border-[#D8DCE8] p-6 rounded-[3px]">
                <div className="font-mono-fin text-[10px] text-[#1B4FD8] tracking-[.1em] mb-2.5">{k}</div>
                <div className="font-serif-cn text-[15px] font-bold text-[#0D2145] mb-1.5">{t}</div>
                <div className="text-[12.5px] text-[#4B5A72] leading-[1.65]">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WORKFLOW ── */}
      <section className="relative z-10 py-20 px-6 md:px-12 bg-[#EEF1F7] border-y border-[#D8DCE8]">
        <div className="max-w-[1280px] mx-auto">
          <div className="font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase flex items-center gap-2.5 mb-3.5">
            <span className="block w-4 h-0.5 bg-[#1B4FD8] rounded-sm" />使用流程 · How It Works
          </div>
          <h2 className="font-serif-cn text-[clamp(26px,2.7vw,40px)] font-bold leading-[1.2] text-[#0D2145] max-w-[520px] mb-12">
            4 步完成一份 BP 的完整尽调
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lp-reveal">
            {WORKFLOW.map((w) => (
              <div key={w.n}>
                <div className="w-[52px] h-[52px] border-2 border-[#1B4FD8] flex items-center justify-center mb-5 bg-white">
                  <span className="font-mono-fin text-[14px] text-[#1B4FD8] font-medium">{w.n}</span>
                </div>
                <div className="font-serif-cn text-[16px] font-bold text-[#0D2145] mb-2">{w.t}</div>
                <div className="text-[13px] text-[#4B5A72] leading-[1.65]">{w.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="relative z-10 py-20 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="font-mono-fin text-[11px] tracking-[.13em] text-[#1B4FD8] uppercase flex items-center gap-2.5 mb-3.5">
            <span className="block w-4 h-0.5 bg-[#1B4FD8] rounded-sm" />服务方案 · Pricing
          </div>
          <h2 className="font-serif-cn text-[clamp(26px,2.7vw,40px)] font-bold leading-[1.2] text-[#0D2145] max-w-[520px] mb-12">
            清晰定价，开箱即用
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lp-reveal">
            {[
              {
                name: "Starter", featured: false, price: "免费", cycle: "每月 5 份 BP 分析",
                features: ["5 维量化评分报告", "声明核查 Red Flag 标注", "Pipeline 流程管理", "PDF 报告导出", "基础模型（标准速度）", "7 天历史记录"],
                btn: { label: "免费注册", primary: false, action: goSignup },
              },
              {
                name: "Professional", featured: true, price: "¥ 499", cycle: "/ 月 · 每月 20 份高级模型分析",
                features: ["不限量 BP 分析", "<strong>高级模型可选</strong>（更强推理能力）", "AI 尽调问卷（DD）+ 校正评分", "多 Agent 工作区", "投资备忘录（IMemo）自动生成", "地理分布地图 + 数据看板", "报告分享链接", "历史记录永久保存"],
                btn: { label: "开始使用", primary: true, action: goSignup },
              },
              {
                name: "Enterprise", featured: false, price: "定制", cycle: "联系我们获取报价",
                features: ["Professional 全部功能", "<strong>顶级旗舰模型</strong>（最高精度）", "私有化部署选项", "自定义评估维度与权重", "API 接口集成", "团队多账号管理", "数据隔离 SLA 保障", "专属培训与支持"],
                btn: { label: "联系销售", primary: false, action: goSignup },
              },
            ].map((p) => (
              <div key={p.name}
                   className={`relative bg-white p-10 rounded-[4px] transition-shadow hover:shadow-[0_10px_36px_rgba(13,33,69,0.1)] ${p.featured ? "border-2 border-[#1B4FD8]" : "border border-[#D8DCE8]"}`}>
                {p.featured && (
                  <div className="absolute -top-px left-1/2 -translate-x-1/2 bg-[#1B4FD8] text-white font-mono-fin text-[10px] tracking-wider px-3 py-0.5 rounded-b-[4px]">
                    最受欢迎
                  </div>
                )}
                <div className="font-mono-fin text-[11px] tracking-[.12em] text-[#1B4FD8] uppercase mb-3.5">{p.name}</div>
                <div className="font-mono-fin text-[38px] font-medium text-[#0D2145] leading-none mb-1">{p.price}</div>
                <div className="font-mono-fin text-[12px] text-[#8E9BB0] mb-6">{p.cycle}</div>
                <div className="h-px bg-[#D8DCE8] mb-5" />
                <ul className="flex flex-col gap-2.5 mb-8 list-none">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[13px] text-[#4B5A72] leading-[1.5]">
                      <span className="text-[#15803D] text-[12px] font-bold shrink-0 mt-0.5">✓</span>
                      <span dangerouslySetInnerHTML={{ __html: f }} />
                    </li>
                  ))}
                </ul>
                <button
                  onClick={p.btn.action}
                  className={`w-full py-3 rounded-[3px] text-[14px] font-semibold transition-all ${
                    p.btn.primary
                      ? "bg-[#1B4FD8] hover:bg-[#163069] text-white"
                      : "bg-transparent border-[1.5px] border-[#0D2145] text-[#0D2145] hover:bg-[#0D2145] hover:text-white"
                  }`}
                >
                  {p.btn.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BAND ── */}
      <section className="relative z-10 bg-[#0D2145] text-center py-24 px-6 md:px-12 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[400px] pointer-events-none"
             style={{ background: "radial-gradient(ellipse, rgba(59,110,245,.15) 0%, transparent 65%)" }} />
        <div className="relative z-10">
          <div className="font-mono-fin text-[11px] tracking-[.13em] text-white/40 uppercase mb-4">立即开始 · Get Started</div>
          <h2 className="font-serif-cn text-[clamp(28px,3.5vw,48px)] font-bold text-white max-w-[600px] mx-auto leading-[1.2] mb-3.5">
            让 AI 帮你筛掉 90% 的无效 BP
          </h2>
          <p className="text-[15px] text-white/50 mb-9">专注精力在真正值得深入研究的项目上</p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={goSignup} className="text-[14px] font-semibold text-[#0D2145] bg-white hover:opacity-90 px-8 py-3.5 rounded-[3px]">
              免费注册账号
            </button>
            <button onClick={goDemo} className="text-[14px] font-medium text-white border-[1.5px] border-white/35 hover:border-white px-8 py-3.5 rounded-[3px] transition-colors">
              查看演示报告
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 bg-white border-t border-[#D8DCE8] pt-13 pb-8 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-[1.5fr_1fr_1fr_1fr] gap-10 mb-10">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <div className="flex items-center gap-2.5 font-serif-cn text-[15px] font-bold text-[#0D2145] mb-3">
              <LogoE size={28} />
              BP过滤机
            </div>
            <div className="text-[13px] text-[#8E9BB0] leading-[1.65] max-w-[240px]">
              一级市场投资人的 AI Workspace。把 BP 分析、尽调流程与投资 Paperwork 交给 AI，让你专注于思考与发掘好项目。
            </div>
          </div>
          {[
            ["产品", [["核心功能", "#features"], ["5维评分体系", "#dimensions"], ["投资流程管理", "#pipeline"], ["定价方案", "#pricing"]]],
            ["公司", [["关于我们", "#"], ["隐私政策", "#"], ["服务条款", "#"], ["联系我们", "#"]]],
            ["资源", [["演示报告", "/demo"], ["使用文档", "#"], ["更新日志", "#"], ["排行榜", "/app/leaderboard"]]],
          ].map(([title, links]) => (
            <div key={title}>
              <h4 className="font-mono-fin text-[10px] tracking-[.12em] text-[#8E9BB0] uppercase mb-3.5">{title}</h4>
              <ul className="flex flex-col gap-2 list-none">
                {links.map(([t, h]) => (
                  <li key={t}>
                    <a href={h} className="text-[13px] text-[#4B5A72] hover:text-[#0D2145] transition-colors">{t}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="max-w-[1280px] mx-auto border-t border-[#D8DCE8] pt-5 flex flex-col md:flex-row justify-between items-center gap-3">
          <div className="font-mono-fin text-[11px] text-[#8E9BB0] tracking-wide">© 2026 BP过滤机 · garbagebpfilter.cn · All rights reserved</div>
          <div className="flex gap-2">
            {["多模型支持", "数据安全", "隐私合规"].map((b) => (
              <span key={b} className="font-mono-fin text-[10px] text-[#8E9BB0] border border-[#D8DCE8] px-2 py-1 rounded-[2px]">{b}</span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
