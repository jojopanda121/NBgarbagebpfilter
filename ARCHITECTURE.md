# 项目技术栈与架构说明

## 技术栈总览

**React 18 + Express.js + MiniMax LLM + Tailwind CSS**

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18.2 (Hooks) |
| 前端样式 | Tailwind CSS 4.0 + PostCSS |
| 前端图表 | Recharts（雷达图） |
| 前端图标 | Lucide-react |
| 后端框架 | Express.js 4.21 (Node.js) |
| AI/LLM | MiniMax-M2.5（兼容 Anthropic SDK） |
| 文件上传 | Multer（最大 50 MB） |
| PDF 解析 | PyMuPDF + Tesseract OCR（Python） |
| 行业数据 | AkShare（A 股 PE 比率） |
| 网络搜索 | Serper.dev API |
| 开发工具 | react-scripts 5.0.1、dotenv、CORS |

---

## 项目目录树

```
garbagebpfilter/
├── .env.example                  # 环境变量配置模板
├── .gitignore
├── README.md                     # 快速启动说明
├── ARCHITECTURE.md               # 本文件：技术栈与架构说明
├── CHANGELOG_5D.md               # 五维评分系统更新日志
├── BUGFIX_解析异常修复说明.md    # JSON 解析修复说明
├── 五维评分系统说明.md           # 评分维度详细说明
├── 测试指南.md                   # 测试方法说明
├── package.json                  # 根级依赖（遗留单体模式）
├── package-lock.json
├── server.js                     # 遗留单体服务器（兼容保留）
├── test-backend.js               # 后端测试脚本
├── test_json_parse.js            # JSON 解析测试
├── test_bp.txt                   # 测试用 BP 文本
├── verdict_payload.json          # 示例裁决 Payload
├── start.sh                      # Mac/Linux 一键启动脚本
├── start.bat                     # Windows 一键启动脚本
│
├── public/                       # 根级静态资源（遗留）
│   └── index.html
│
├── client/                       # React 前端（v2.0 模块化）
│   ├── package.json              # 前端依赖
│   ├── package-lock.json
│   ├── postcss.config.js         # PostCSS / Tailwind 配置
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.jsx               # 主组件（UI + 状态管理，约 3000 行）
│       ├── index.js              # React 入口
│       └── index.css             # 全局样式
│
├── server/                       # Express 后端（v2.0 模块化）
│   ├── package.json              # 后端依赖
│   ├── package-lock.json
│   ├── index.js                  # Express 主服务（三步流水线）
│   └── scoring.js                # 五维评分引擎
│
├── src/                          # 遗留源码目录
│   ├── App.js
│   └── index.js
│
└── scripts/                      # Python 辅助脚本
    ├── requirements.txt          # Python 依赖
    ├── extract_pdf.py            # PDF 文字提取（PyMuPDF + OCR）
    ├── industry_pe.py            # 行业 PE 查询（AkShare）
    └── pdf_to_text.py            # PDF 转文本
```

---

## 核心架构说明

### 系统定位

**垃圾 BP 过滤器**是一款面向早期投资机构的 AI 尽职调查工具，核心能力是对初创企业商业计划书（BP）进行自动化事实核查与五维量化评分，识别数据注水与逻辑矛盾，辅助投资人快速筛选项目。

---

### 整体架构：前后端分离 + 三步流水线

```
┌─────────────────────────────────────────────────┐
│               React 前端 (port 3000)             │
│  拖拽上传 PDF → 步骤进度条 → 雷达图 + 报告渲染  │
└───────────────────────┬─────────────────────────┘
                        │ HTTP (multipart/form-data)
                        ▼
┌─────────────────────────────────────────────────┐
│             Express 后端 (port 3001)             │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │  Step 1：Agent A — 数据提取              │   │
│  │  从 BP 中抽取 11 个标准化指标            │   │
│  │  输出：结构化 JSON + 待搜索查询词        │   │
│  └───────────────────┬──────────────────────┘   │
│                      │                          │
│  ┌───────────────────▼──────────────────────┐   │
│  │  Step 2：并行证据采集                    │   │
│  │  ├─ Serper.dev（最多 12 并发搜索）       │   │
│  │  ├─ AkShare（行业 PE 基准）              │   │
│  │  └─ 估值背景搜索                         │   │
│  └───────────────────┬──────────────────────┘   │
│                      │                          │
│  ┌───────────────────▼──────────────────────┐   │
│  │  Step 3：Agent B — 数据校验 + 评分       │   │
│  │  BP 声明 vs 搜索证据交叉验证             │   │
│  │  识别冲突 → 校准指标 → 五维评分          │   │
│  │  生成深度研究报告                        │   │
│  └───────────────────┬──────────────────────┘   │
│                      │                          │
│         scoring.js 评分引擎（公式计算）         │
└───────────────────────┬─────────────────────────┘
                        │
           ┌────────────▼────────────┐
           │  Python 子进程（按需）   │
           │  PyMuPDF + Tesseract     │
           │  （PDF 文字提取 / OCR） │
           └─────────────────────────┘
```

---

### 五维评分系统（v3.0）

| 维度 | 权重 | 核心公式 | 关键指标 |
|------|------|----------|----------|
| **S1 时间与天花板** | 20% | `min[100, 20×log₁₀(TAM+1) + 2×CAGR]` | 市场规模、增速 |
| **S2 产品与护城河** | 25% | `0.4×(TRL/9×100) + 0.6×SC` | 技术成熟度、转换成本 |
| **S3 商业验证** | 35% | `0.7×f(LTV/CAC) + 0.3×Margin×100` | 单元经济、毛利率 |
| **S4 团队基因** | 20% | `min(100, Exp×10) - Penalty(Equity)` | 从业年限、股权结构 |
| **V5 外部风险** | 乘数 | `Policy_Risk × Discount(估值差)` | 政策风险、估值合理性 |

**最终得分** = `(S1×0.2 + S2×0.25 + S3×0.35 + S4×0.2) × V5`

**评级**：
- **A ≥ 85**：快速通道，建议直投
- **B 75–84**：建议尽调，谨慎推进
- **C 60–74**：持续观察，等待 POC
- **D < 60**：归档拒绝，存在结构性问题

---

### API 端点（后端 /server/index.js）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 + 当前模型信息 |
| GET | `/api/search-status` | 是否启用网络搜索 |
| POST | `/api/analyze` | **主分析接口**（multipart/form-data） |
| POST | `/api/pdf-to-text` | PDF 文字提取 |
| POST | `/api/extract-claims` | 遗留：BP 声明提取 |
| POST | `/api/web-search` | 遗留：批量搜索 |
| POST | `/api/verdict` | 遗留：生成裁决 |

---

### 关键设计决策

1. **对数防通货膨胀**：TAM 使用 `log₁₀` 函数，防止企业虚报市场规模刷高分。
2. **一票否决（V5）**：外部风险维度可将任何高分项目直接降级至 D，规避政策黑天鹅。
3. **扩展思考模式**：MiniMax 模型启用 extended thinking（最多 4096 token 思维链），推理过程在前端可展开查看。
4. **Mock 模式**：未配置 Serper API Key 时自动降级为 Mock 搜索，保证全流程可离线测试。
5. **JSON 容错解析**：自定义 `extractJson()` + `attemptJsonFix()` 处理 LLM 输出中常见的 Markdown 代码块、trailing comma、单引号等格式问题。
6. **Python 子进程隔离**：PDF 解析与行业数据查询通过 `child_process.spawn` 调用 Python，设置 120s 超时与 20 MB 缓冲区上限，避免阻塞主进程。

---

### 环境变量

```bash
MINIMAX_API_KEY=sk-...        # 必填：MiniMax LLM API Key
MINIMAX_MODEL=MiniMax-M2.5    # 可选：默认 M2.5
PORT=3001                      # 可选：后端端口，默认 3001
SERPER_API_KEY=...             # 可选：启用网络搜索（缺失则 Mock 模式）
```
