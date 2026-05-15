# 怎么加一个新的 PPT 模板（harness 范式 SOP）

> 设计契约： **版式归代码，内容归 agent，JSON 是合约**。
> 加新模板永远不要在 agent prompt / 前端 / Node 层写"字号 / 颜色 / 坐标"。

## 四个文件 + 一行注册 = 一个新模板

以"路演 5 页 deck"为例。

### 1. `doc-service/roadshow_render.py` （锁版式）

照 `investment_snapshot_render.py` / `project_brief_render.py` 的结构写：

```python
from brand_tokens import (
    COLOR, FONT_CN_SERIF, FONT_CN_SANS, FONT_EN, SIZE,
    RULE_PT, HAIRLINE_PT,
    add_rect, set_run, add_text, add_para,
)

# LAYOUT 锁死在文件顶部 (坐标 / 栏宽 / 间距).
# 颜色 / 字体 / 字号一律从 brand_tokens 取, 严禁本地硬编码 RGBColor / "微软雅黑" / Pt(N).
# 实现 render(content: dict, out_path: str)
```

**任何决定都要锁在这里**：页数、栏数、装饰条、是否带页脚……都不能传参。

**视觉一致性硬约束**：
- 颜色 / 字体 / 字号 100% 走 `brand_tokens`。本地 `RGBColor(0xAA, ...)` / `font_name="..."` / `Pt(任意数)` 一律视为破坏品牌一致性, PR 拒收.
- 同一份 JSON 必须产出"结构等价" PPT — 见 `server/tests/workspace/brandConsistency.test.js` 的 `stripTextKeepGeom` 等价定义.
- Node 侧 (pptxgenjs) 渲染同理: `require("./brandTokens")`, 不要硬编码 6 位 hex.

### 2. `doc-service/main.py` 加 endpoint

```python
@app.post("/generate/roadshow")
async def generate_roadshow(payload: dict):
    import roadshow_render as rs
    # 照抄 generate_project_brief 的 try/except 模板
```

### 3. `server/services/roadshow/` 三件套

- `content_schema.json` —— JSON Schema，每个字段写清楚字数上下限、出现位置（哪页 / 哪格），数量刚性约束（"必须恰好 5 条"用 `minItems`/`maxItems` 锁）
- `AGENT_SYSTEM_PROMPT.md` —— sub-agent 的 system prompt。模仿现有模板的"你不要 / 你要 / 自检清单"三段式
- `example_xxx.json` —— 一份填满的真实样例，**既是 few-shot 也是回归基线**

### 4. `server/services/roadshow/index.js` 一行 createTemplate

```js
const { createTemplate } = require("../pptxTemplate");

module.exports = createTemplate({
  name: "roadshow",
  assetsDir: __dirname,
  exampleFile: "example_xxx.json",
  endpoint: "/generate/roadshow",
  filenameOf: (json) => `路演_${json.company_full_name}.pptx`,
});
```

### 5. `server/skills/roadshow.js` 注册到 catalog

照抄 `server/skills/projectBrief.js`，关键四件事：

```js
id: "roadshow",
title: "路演 5 页 deck",
outputArtifactKind: "pptx",
pptxTemplate: {                          // ← 必须有, host prompt 据此动态展示
  useCase: "适用 X / Y / Z 场景, 5 页, 不适合 A 场景",
  pageCount: "exactly 5",
  argsHint: '<TOOL_CALL>{"id":"roadshow","args":{"materials":"<原文>"}}</TOOL_CALL>',
},
inputSchema: { /* materials + company_hint 即可, 不要暴露版式字段 */ },
async run({ project, params, ctx }) { /* 照抄 projectBrief.run */ },
```

最后在 `server/skills/index.js` 的 `builtins` 数组里加一行 `require("./roadshow")`。

## 测试

`server/tests/workspace/<name>.test.js` —— 照 `investmentSnapshot.test.js`：

- 校验合法 JSON / 缺字段 / 数量约束
- e2e: 调 doc-service 渲染 → 解 zip 抓 slide xml → 断言关键字段出现
- 注册检查: skill 出现在 `listPptxTemplates()` 输出里

## 永远不要做的事

- ❌ 不要在 `inputSchema` 暴露 `title` / `subtitle` / `color` / `slides[]` 这种版式字段。Agent 只填内容。
- ❌ 不要在 host prompt 里硬编码新模板的描述 —— host prompt 是从 `listPptxTemplates()` 动态拉的。
- ❌ 不要让 Node 层做任何样式判断（"如果材料长就加一页"之类）。版式归 Python，分支也写在 Python。
- ❌ 不要复用 `generate_pptx` 老路径 —— 它已被禁用。
- ❌ 不要为了"语言一致"把 Python 渲染脚本 port 到 JS。Python 已部署。
- ❌ 不要在渲染脚本里硬编码任何颜色 / 字体 / 字号。所有视觉 token 走 `brand_tokens.py` (Python) 或 `server/services/brandTokens.js` (Node)，与 `client/src/index.css` :root 同源。

## 给自己的检查（开 PR 前）

- [ ] `python doc-service/<name>_render.py example.json /tmp/out.pptx` 可跑
- [ ] `curl -X POST -d @example.json $DOC/generate/<endpoint>` 200
- [ ] `node -e 'require("./server/skills").init()'` 看到新 skill 注册日志
- [ ] e2e 测试通过, 含 zip 内 slide xml 关键字段断言
- [ ] host prompt 没硬编码新模板名（应当来自 catalog）
