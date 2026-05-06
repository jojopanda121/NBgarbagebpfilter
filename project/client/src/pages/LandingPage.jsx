import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

const LogoE = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="6" fill="#1B4FD8" />
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

function useCanvasBackground(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W, H, nodes, animId;
    const NAVY = "13,33,69";
    const BLUE = "27,79,216";

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function makeNodes(n) {
      return Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.8 + 0.6,
        pulse: Math.random() * Math.PI * 2,
      }));
    }

    function draw(t) {
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

      const LINK_DIST = Math.min(W, H) * 0.14;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.1;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(${BLUE},${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      nodes.forEach((nd) => {
        const pulse = Math.sin(nd.pulse) * 0.3 + 0.7;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, nd.r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${BLUE},${0.18 * pulse})`;
        ctx.fill();
      });

      const lineCount = 6;
      for (let i = 0; i < lineCount; i++) {
        const y = ((t * 0.018 + i / lineCount) % 1) * H;
        const lineGrad = ctx.createLinearGradient(0, y, W, y);
        lineGrad.addColorStop(0, `rgba(${BLUE},0)`);
        lineGrad.addColorStop(0.5, `rgba(${BLUE},0.028)`);
        lineGrad.addColorStop(1, `rgba(${BLUE},0)`);
        ctx.fillStyle = lineGrad;
        ctx.fillRect(0, y, W, 1.5);
      }

      animId = requestAnimationFrame(draw);
    }

    function init() {
      resize();
      nodes = makeNodes(55);
      cancelAnimationFrame(animId);
      animId = requestAnimationFrame(draw);
    }

    function onResize() {
      resize();
      nodes = makeNodes(55);
    }

    window.addEventListener("resize", onResize);
    init();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, [canvasRef]);
}

function useScrollReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08 }
    );
    document.querySelectorAll(".lp-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function LandingPage() {
  const canvasRef = useRef(null);
  const navigate = useNavigate();

  useCanvasBackground(canvasRef);
  useScrollReveal();

  return (
    <>
      <canvas ref={canvasRef} id="bg-canvas" />

      {/* NAV */}
      <nav className="lp-nav">
        <a href="#" className="lp-nav-logo">
          <div className="lp-nav-mark">
            <LogoE size={32} />
          </div>
          <span className="lp-nav-name">BP过滤机</span>
        </a>
        <div className="lp-nav-links">
          <a href="#features">核心功能</a>
          <a href="#dimensions">评分体系</a>
          <a href="#pipeline">投资流程</a>
          <a href="#pricing">定价</a>
        </div>
        <div className="lp-nav-right">
          <button className="lp-btn-ghost" onClick={() => navigate("/login")}>登录</button>
          <button className="lp-btn-primary" onClick={() => navigate("/login")}>免费注册</button>
        </div>
      </nav>

      {/* HERO */}
      <div className="lp-hero">
        <div className="lp-hero-blob" />
        <div className="lp-hero-blob2" />
        <div className="lp-hero-inner">
          <div>
            <div className="lp-hero-eyebrow">The AI Workspace for VC &amp; PE</div>
            <h1 className="lp-hero-h1">
              让每一个投资判断<br /><em>有据可依</em>
            </h1>
            <p className="lp-hero-sub">
              专为一级市场投资人打造的智能工作台。独创量化评分体系精准评估每份 BP，AI 逐条击破虚假陈述，多 Agent 协同覆盖分析、尽调、投资备忘录全链路。<br />
              <strong>把繁琐留给 AI，把判断留给自己。</strong>
            </p>
            <div className="lp-hero-ctas">
              <button className="lp-btn-primary" onClick={() => navigate("/login")}>免费开始使用 →</button>
              <button className="lp-btn-outline">查看演示报告</button>
            </div>
            <div className="lp-hero-trust">
              <div className="lp-trust-item">
                <div className="lp-trust-check">✓</div>独创量化评分体系
              </div>
              <div className="lp-trust-item">
                <div className="lp-trust-check">✓</div>虚假陈述逐条击破
              </div>
              <div className="lp-trust-item">
                <div className="lp-trust-check">✓</div>多模型按需切换
              </div>
            </div>
          </div>

          {/* ANALYSIS PANEL MOCKUP */}
          <div className="lp-hero-panel">
            <div className="lp-panel-chrome">
              <div className="lp-chrome-dot" style={{ background: "#FF5F57" }} />
              <div className="lp-chrome-dot" style={{ background: "#FEBC2E" }} />
              <div className="lp-chrome-dot" style={{ background: "#28C840" }} />
              <span className="lp-chrome-label">BP过滤机 · Project Detail</span>
            </div>
            <div className="lp-panel-body">
              <div className="lp-panel-tabs">
                <div className="lp-panel-tab active">分析报告</div>
                <div className="lp-panel-tab">工作区</div>
                <div className="lp-panel-tab">尽调问卷</div>
                <div className="lp-panel-tab">投资备忘录</div>
                <div className="lp-panel-tab">项目备注</div>
              </div>
              <div className="lp-panel-content">
                {/* project meta */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 3 }}>
                    某智能制造 SaaS
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", fontWeight: 600 }}>BP-2024-0087</span>
                    <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 500 }}>Pre-A · 3,000 万人民币</span>
                    <div className="lp-stages-row">
                      <span className="lp-stage-pill lp-sp-done">已评估</span>
                      <span className="lp-stage-pill lp-sp-act">尽调中</span>
                      <span className="lp-stage-pill lp-sp-next">已决策</span>
                    </div>
                  </div>
                </div>
                {/* score */}
                <div className="lp-score-row">
                  <div className="lp-score-num">67<sub>/100</sub></div>
                  <div className="lp-score-meta">
                    <div className="lp-score-lbl">综合评分 · Overall Score</div>
                    <div className="lp-verdict-pill lp-vp-warn">B — 谨慎推荐</div>
                  </div>
                </div>
                {/* dims */}
                <div className="lp-dims">
                  {[
                    { name: "时机与天花板", pct: 78, cls: "hi" },
                    { name: "产品与壁垒",   pct: 62, cls: "mid" },
                    { name: "资本效率",     pct: 70, cls: "mid" },
                    { name: "团队基因",     pct: 74, cls: "hi" },
                    { name: "BP诚信度",     pct: 32, cls: "lo" },
                  ].map((d) => (
                    <div className="lp-dim-row" key={d.name}>
                      <span className="lp-dim-name">{d.name}</span>
                      <div className="lp-dim-track">
                        <div className={`lp-dim-fill ${d.cls}`} style={{ width: `${d.pct}%` }} />
                      </div>
                      <span className="lp-dim-score">{d.pct}</span>
                    </div>
                  ))}
                </div>
                {/* flags */}
                <div className="lp-flags">
                  <div className="lp-flags-label">声明核查 · Claim Verification</div>
                  <div className="lp-flag-item">
                    <span className="lp-flag-ico lp-fi-bad">✗</span>
                    <span className="lp-flag-text">「全球 TAM 超 5,000 亿」— 核查：严重夸大，细分市场仅 200 亿</span>
                  </div>
                  <div className="lp-flag-item">
                    <span className="lp-flag-ico lp-fi-bad">✗</span>
                    <span className="lp-flag-text">「独家专利技术」— 核查：专利申请中，尚未授权</span>
                  </div>
                  <div className="lp-flag-item">
                    <span className="lp-flag-ico lp-fi-ok">✓</span>
                    <span className="lp-flag-text">「已签约 3 家 500 强客户」— 核查：信息属实</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* METRICS BAR */}
      <div className="lp-metrics-bar">
        <div className="lp-metric-cell">
          <div className="lp-metric-n">5</div>
          <div className="lp-metric-d">维度量化评分，每维度独立建模，数学公式驱动</div>
        </div>
        <div className="lp-metric-cell">
          <div className="lp-metric-n">&lt; 3<em> min</em></div>
          <div className="lp-metric-d">单份 BP 分析完成，传统人工需要 2–4 小时</div>
        </div>
        <div className="lp-metric-cell">
          <div className="lp-metric-n">90<em>%</em></div>
          <div className="lp-metric-d">噪声过滤率，帮助投资人聚焦有价值的项目</div>
        </div>
        <div className="lp-metric-cell">
          <div className="lp-metric-n">50,000<em>+</em></div>
          <div className="lp-metric-d">已分析 BP 数量，持续迭代行业专属模型</div>
        </div>
      </div>

      {/* FEATURES */}
      <div className="lp-section" id="features">
        <div className="lp-section-inner">
          <div className="lp-sec-tag">核心功能 · Core Features</div>
          <div className="lp-sec-h2">从 BP 上传到投资决策，全流程 AI 辅助</div>
          <div className="lp-feat-grid lp-reveal">
            {[
              {
                n: "01", title: "5维量化评分模型",
                desc: <>告别「拍脑袋打分」。AI 输出<em>严谨枚举值与绝对数值</em>，JS 端执行纯数学计算，每维度有独立公式与业务逻辑，结果完全可追溯。</>,
              },
              {
                n: "02", title: "声明逐条核查",
                desc: <>针对 BP 中每条关键声明，AI 扮演<em>行业专家 + 投资专家</em>进行辩证研究，输出「诚实 / 存疑 / 夸大 / 证伪」结论，直接反映 BP 诚信度评分。</>,
              },
              {
                n: "03", title: "尽调问卷（DD）",
                desc: <>一键启动<em>AI 生成定制化尽调问卷</em>，完成后自动重新评分，体现尽调信息对综合判断的校正。Pipeline 状态同步更新。</>,
              },
              {
                n: "04", title: "多 Agent 工作区",
                desc: <>每个项目有独立工作区，支持与<em>多个专业 Agent 对话</em>——市场分析、财务模型、竞品研究、风险评估，随时调出深度分析。</>,
              },
              {
                n: "05", title: "投资备忘录生成",
                desc: <>一键输出符合<em>机构投委会标准</em>的结构化投资备忘录（IMemo），包含项目摘要、风险矩阵、尽调结论，可直接归档或分享。</>,
              },
              {
                n: "06", title: "Pipeline 投资流程管理",
                desc: <>从 <em>新建 → 评估 → 尽调 → 决策 → 投资/否决</em>，完整的项目生命周期管理。支持标签、跟进日期提醒、省份地图分布可视化。</>,
              },
            ].map((f) => (
              <div className="lp-feat" key={f.n}>
                <div className="lp-feat-num">{f.n}</div>
                <div className="lp-feat-title">{f.title}</div>
                <div className="lp-feat-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5 DIMENSIONS */}
      <div className="lp-section alt" id="dimensions">
        <div className="lp-section-inner">
          <div className="lp-sec-tag">评分体系 · Scoring Dimensions</div>
          <div className="lp-sec-h2">五大维度全面评估，量化替代直觉，结果有据可查</div>
          <div className="lp-dim5-grid lp-reveal">
            {[
              {
                wt: "维度一", name: "时机与天花板",
                sub: "AI 主动检索细分赛道的真实市场规模与增速，不采信 BP 自称数据，给出独立判断。",
                formula: "市场规模 · 行业增速\n赛道成熟度",
              },
              {
                wt: "维度二", name: "产品与壁垒",
                sub: "交叉比对行业真实竞品，客观评估技术成熟度与差异化壁垒深度。",
                formula: "技术就绪度 · 竞品排名\n护城河强度",
              },
              {
                wt: "维度三", name: "资本效率与规模效应",
                sub: "基于顶级 VC 研究框架评估赛道商业属性，早期项目同样适用。",
                formula: "轻重资产结构 · 边际成本\n网络效应潜力",
              },
              {
                wt: "维度四", name: "团队基因",
                sub: "多因子综合评估创始团队，经验深度、行业匹配度、团队完整性缺一不可。",
                formula: "行业经验 · 赛道匹配\n过往战绩 · 团队结构",
              },
              {
                wt: "维度五", name: "BP 诚信度",
                sub: "AI 逐条核查 BP 中的关键声明，识别夸大、包装与事实性错误，量化可信程度。",
                formula: "声明核查 · 数据溯源\n一致性验证",
              },
            ].map((d) => (
              <div className="lp-dim5-card" key={d.wt}>
                <div className="lp-dim5-wt">{d.wt}</div>
                <div className="lp-dim5-name">{d.name}</div>
                <div className="lp-dim5-sub">{d.sub}</div>
                <div className="lp-dim5-formula">{d.formula}</div>
              </div>
            ))}
          </div>

          {/* Grade table */}
          <div className="lp-scorecard-grid lp-reveal" style={{ marginTop: 56 }}>
            <div>
              <div className="lp-sec-tag" style={{ marginBottom: 14 }}>评级体系 · Grading</div>
              <table className="lp-grade-table">
                <thead>
                  <tr>
                    <th>评级</th>
                    <th>分数区间</th>
                    <th>结论</th>
                    <th>行动建议</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="lp-grade-badge lp-gb-a">A</span></td>
                    <td><span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)", fontWeight: 600 }}>≥ 85</span></td>
                    <td style={{ fontWeight: 700, color: "var(--green)" }}>强烈推荐 Fast Track</td>
                    <td className="lp-grade-action">24小时内约见创始人，立即启动尽调</td>
                  </tr>
                  <tr>
                    <td><span className="lp-grade-badge lp-gb-b">B</span></td>
                    <td><span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)", fontWeight: 600 }}>70–84</span></td>
                    <td style={{ fontWeight: 700, color: "var(--accent)" }}>谨慎推荐 Proceed DD</td>
                    <td className="lp-grade-action">安排面谈，验证单位经济模型</td>
                  </tr>
                  <tr>
                    <td><span className="lp-grade-badge lp-gb-c">C</span></td>
                    <td><span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)", fontWeight: 600 }}>60–69</span></td>
                    <td style={{ fontWeight: 700, color: "var(--amber)" }}>观望跟踪 Keep In View</td>
                    <td className="lp-grade-action">季度跟踪，关注关键里程碑达成</td>
                  </tr>
                  <tr>
                    <td><span className="lp-grade-badge lp-gb-d">D</span></td>
                    <td><span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)", fontWeight: 600 }}>&lt; 60</span></td>
                    <td style={{ fontWeight: 700, color: "var(--red)" }}>建议放弃 Reject</td>
                    <td className="lp-grade-action">归档并标注否决原因，供投委会复盘</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="lp-sec-tag" style={{ marginBottom: 14 }}>为什么不一样 · Why It's Different</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  {
                    title: "客观，而非依赖大模型感觉",
                    desc: "市面上大多数 AI 分析工具让模型直接「给个评分」。我们不同——AI 只负责检索与分类，评分由独立的量化模型计算，结论有据可查，不受模型幻觉影响。",
                  },
                  {
                    title: "不错杀潜力项目",
                    desc: "我们的模型专为早期项目优化。即使 BP 信息不完整，也不会因此重度惩罚评分。对于信息存疑的声明，系统给予中性处理，只有确凿的夸大才会影响结论。",
                  },
                  {
                    title: "垂直赛道同样适用",
                    desc: "评分体系专为中国新兴赛道校准，不用旧时代「百亿市场」的标准误杀精品垂直项目。具身智能、低空经济、合成生物——每个赛道都能得到公平评估。",
                  },
                ].map((w) => (
                  <div className="lp-why-card" key={w.title}>
                    <div className="lp-why-title">{w.title}</div>
                    <div className="lp-why-desc">{w.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PIPELINE */}
      <div className="lp-section" id="pipeline">
        <div className="lp-section-inner">
          <div className="lp-sec-tag">投资流程 · Deal Pipeline</div>
          <div className="lp-sec-h2">从 BP 到投资决策，7 阶段全程追踪</div>
          <div className="lp-pipeline-wrap lp-reveal">
            <div className="lp-pipeline-line" />
            <div className="lp-pipeline-steps">
              {[
                { n: "01", label: "新建",       desc: "BP 上传完成，自动创建项目",   done: true },
                { n: "02", label: "已评估",     desc: "查阅报告后自动标记",         done: true },
                { n: "03", label: "待尽调",     desc: "标记值得深入的项目",         done: true },
                { n: "04", label: "尽调中",     desc: "AI 生成问卷，逐条填写",      done: false },
                { n: "05", label: "尽调完成",   desc: "评分自动校正，IMemo 生成",   done: false },
                { n: "06", label: "已决策",     desc: "投委会审议结论记录",         done: false },
                { n: "07", label: "已投资 / 已否决", desc: "归档，供日后复盘参考", done: false },
              ].map((s) => (
                <div className="lp-pipe-step" key={s.n}>
                  <div className={`lp-pipe-dot${s.done ? " done" : ""}`}>
                    <span className="lp-pipe-dot-num">{s.n}</span>
                  </div>
                  <div className="lp-pipe-label">{s.label}</div>
                  <div className="lp-pipe-desc">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Extra features row */}
          <div
            className="lp-reveal"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20, marginTop: 52 }}
          >
            {[
              { tag: "SHARE", title: "报告分享",     desc: "生成 3 天有效分享链接，报告可对外分享，附邀请码追踪。" },
              { tag: "GEO",   title: "地理分布看板", desc: "中国省份地图可视化，一眼看清项目地理集中度与覆盖范围。" },
              { tag: "STATS", title: "个人数据看板", desc: "6个月趋势折线图、评级分布饼图、赛道分布，量化你的投资视野。" },
              { tag: "RANK",  title: "排行榜",       desc: "与其他投资人比较分析数量与平均评分，发现行业热度趋势。" },
            ].map((c) => (
              <div className="lp-extra-card" key={c.tag}>
                <div className="lp-extra-tag">{c.tag}</div>
                <div className="lp-extra-title">{c.title}</div>
                <div className="lp-extra-desc">{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* WORKFLOW */}
      <div className="lp-section alt">
        <div className="lp-section-inner">
          <div className="lp-sec-tag">使用流程 · How It Works</div>
          <div className="lp-sec-h2">4 步完成一份 BP 的完整尽调</div>
          <div className="lp-workflow-grid lp-reveal">
            {[
              {
                n: "01", title: "注册 · 上传 BP",
                desc: "支持 PDF/DOCX，绑定邮箱后即可上传。支持文字版与扫描版 PDF，最大提取 30,000 字符。",
              },
              {
                n: "02", title: "AI 深度解析",
                desc: "顶级大模型扮演行业专家 + 投资专家，逐条核查声明真实性，输出 5 维度量化数据，3 分钟完成。支持多模型选择。",
              },
              {
                n: "03", title: "获取评分报告",
                desc: "查看量化评分、声明核查结果、评级（A/B/C/D）与行动建议。可一键启动尽调问卷深入评估。",
              },
              {
                n: "04", title: "Pipeline 跟进",
                desc: "项目自动进入 Pipeline，生成 IMemo，标注阶段与标签，设置跟进日期，与团队分享报告。",
              },
            ].map((s) => (
              <div className="lp-wf-step" key={s.n}>
                <div className="lp-wf-num-wrap"><span className="lp-wf-num">{s.n}</span></div>
                <div className="lp-wf-title">{s.title}</div>
                <div className="lp-wf-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div className="lp-section" id="pricing">
        <div className="lp-section-inner">
          <div className="lp-sec-tag">服务方案 · Pricing</div>
          <div className="lp-sec-h2">清晰定价，开箱即用</div>
          <div className="lp-pricing-grid lp-reveal">
            {/* Starter */}
            <div className="lp-plan">
              <div className="lp-plan-name">Starter</div>
              <div className="lp-plan-price">免费</div>
              <div className="lp-plan-cycle">每月 5 份 BP 分析</div>
              <div className="lp-plan-hr" />
              <ul className="lp-plan-features">
                <li>5 维量化评分报告</li>
                <li>声明核查 Red Flag 标注</li>
                <li>Pipeline 流程管理</li>
                <li>PDF 报告导出</li>
                <li>基础模型（标准速度）</li>
                <li>7 天历史记录</li>
              </ul>
              <button className="lp-btn-outline" style={{ width: "100%", padding: 11 }} onClick={() => navigate("/login")}>
                免费注册
              </button>
            </div>

            {/* Professional (featured) */}
            <div className="lp-plan featured">
              <div className="lp-plan-badge">最受欢迎</div>
              <div className="lp-plan-name">Professional</div>
              <div className="lp-plan-price">¥ 499</div>
              <div className="lp-plan-cycle">/ 月 · 每月 20 份高级模型分析</div>
              <div className="lp-plan-hr" />
              <ul className="lp-plan-features">
                <li>不限量 BP 分析</li>
                <li><strong>高级模型可选</strong>（更强推理能力）</li>
                <li>AI 尽调问卷（DD）+ 校正评分</li>
                <li>多 Agent 工作区</li>
                <li>投资备忘录（IMemo）自动生成</li>
                <li>地理分布地图 + 数据看板</li>
                <li>报告分享链接</li>
                <li>历史记录永久保存</li>
              </ul>
              <button className="lp-btn-primary" style={{ width: "100%", padding: 11 }} onClick={() => navigate("/login")}>
                开始使用
              </button>
            </div>

            {/* Enterprise */}
            <div className="lp-plan">
              <div className="lp-plan-name">Enterprise</div>
              <div className="lp-plan-price">定制</div>
              <div className="lp-plan-cycle">联系我们获取报价</div>
              <div className="lp-plan-hr" />
              <ul className="lp-plan-features">
                <li>Professional 全部功能</li>
                <li><strong>顶级旗舰模型</strong>（最高精度）</li>
                <li>私有化部署选项</li>
                <li>自定义评估维度与权重</li>
                <li>API 接口集成</li>
                <li>团队多账号管理</li>
                <li>数据隔离 SLA 保障</li>
                <li>专属培训与支持</li>
              </ul>
              <button className="lp-btn-outline" style={{ width: "100%", padding: 11 }}>
                联系销售
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CTA BAND */}
      <div className="lp-cta-band">
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="lp-cta-tag">立即开始 · Get Started</div>
          <div className="lp-cta-h2">让 AI 帮你筛掉 90% 的无效 BP</div>
          <div className="lp-cta-sub">专注精力在真正值得深入研究的项目上</div>
          <div className="lp-cta-actions">
            <button className="lp-btn-white" onClick={() => navigate("/login")}>免费注册账号</button>
            <button className="lp-btn-ghost-white">预约产品演示</button>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-footer-grid">
          <div>
            <div className="lp-footer-logo">
              <LogoE size={28} />
              BP过滤机
            </div>
            <div className="lp-footer-tag">
              一级市场投资人的 AI Workspace。把 BP 分析、尽调流程与投资 Paperwork 交给 AI，让你专注于思考与发掘好项目。
            </div>
          </div>
          <div className="lp-footer-col">
            <h4>产品</h4>
            <ul>
              <li><a href="#features">核心功能</a></li>
              <li><a href="#dimensions">5维评分体系</a></li>
              <li><a href="#pipeline">投资流程管理</a></li>
              <li><a href="#pricing">定价方案</a></li>
            </ul>
          </div>
          <div className="lp-footer-col">
            <h4>公司</h4>
            <ul>
              <li><a href="#">关于我们</a></li>
              <li><a href="#">隐私政策</a></li>
              <li><a href="#">服务条款</a></li>
              <li><a href="#">联系我们</a></li>
            </ul>
          </div>
          <div className="lp-footer-col">
            <h4>资源</h4>
            <ul>
              <li><a href="#">演示报告</a></li>
              <li><a href="#">使用文档</a></li>
              <li><a href="#">更新日志</a></li>
              <li><a href="#">排行榜</a></li>
            </ul>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <div className="lp-footer-copy">© 2026 BP过滤机 · garbagebpfilter.cn · All rights reserved</div>
          <div className="lp-footer-badges">
            <span className="lp-fbadge">多模型支持</span>
            <span className="lp-fbadge">数据安全</span>
            <span className="lp-fbadge">隐私合规</span>
          </div>
        </div>
      </footer>
    </>
  );
}
