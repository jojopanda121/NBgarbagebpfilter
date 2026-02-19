// JSON 解析测试脚本
// 用于测试各种可能的 LLM 输出格式

/** 尝试修复常见的 JSON 格式问题 */
function attemptJsonFix(str) {
  if (!str) return str;
  
  let fixed = str;
  
  // 修复常见问题：
  // 1. 移除 BOM 和零宽字符
  fixed = fixed.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  
  // 2. 移除对象/数组末尾的逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  // 3. 移除注释
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
  
  return fixed.trim();
}

/** 清理 LLM 输出中的非标准 JSON（尾逗号、注释等） */
function sanitizeJsonString(str) {
  // 去掉单行注释 // ...
  str = str.replace(/\/\/[^\n]*/g, "");
  // 去掉多行注释 /* ... */
  str = str.replace(/\/\*[\s\S]*?\*\//g, "");
  // 去掉尾逗号: ,} 或 ,]
  str = str.replace(/,\s*([\]}])/g, "$1");
  return str.trim();
}

/** 从 LLM 输出中提取 JSON（增强容错） */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") {
    console.warn("[extractJson] 输入为空或非字符串");
    return null;
  }

  const candidates = [];

  // 1) 尝试提取 ```json ... ``` 或 ``` ... ``` 代码块（支持多种格式）
  const fencedPatterns = [
    /```json\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
    /`{3,}\s*json\s*([\s\S]*?)`{3,}/,
  ];
  
  for (const pattern of fencedPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      candidates.push(match[1].trim());
    }
  }

  // 2) 找到最外层 { ... } 边界（更精确的匹配）
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = raw.slice(firstBrace, lastBrace + 1);
    candidates.push(jsonCandidate);
    
    // 尝试找到第一个完整的 JSON 对象（处理嵌套大括号）
    let braceCount = 0;
    let startIdx = firstBrace;
    for (let i = firstBrace; i < raw.length; i++) {
      if (raw[i] === "{") braceCount++;
      if (raw[i] === "}") braceCount--;
      if (braceCount === 0) {
        candidates.push(raw.slice(startIdx, i + 1));
        break;
      }
    }
  }

  // 3) 原始文本本身
  candidates.push(raw.trim());

  // 逐个候选尝试解析
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;

    // 尝试 1: 直接解析
    try {
      const parsed = JSON.parse(candidate);
      console.log(`✓ 成功解析（候选 ${i + 1}/${candidates.length}，直接解析）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`候选 ${i + 1} 直接解析失败:`, e.message);
      }
    }

    // 尝试 2: sanitize 后解析
    try {
      const cleaned = sanitizeJsonString(candidate);
      const parsed = JSON.parse(cleaned);
      console.log(`✓ 成功解析（候选 ${i + 1}/${candidates.length}，sanitize 后）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`候选 ${i + 1} sanitize 后解析失败:`, e.message);
      }
    }

    // 尝试 3: 修复常见问题后解析
    try {
      const fixed = attemptJsonFix(candidate);
      const parsed = JSON.parse(fixed);
      console.log(`✓ 成功解析（候选 ${i + 1}/${candidates.length}，修复后）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`候选 ${i + 1} 修复后解析失败:`, e.message);
      }
    }

    // 尝试 4: 组合修复
    try {
      const fixed = attemptJsonFix(sanitizeJsonString(candidate));
      const parsed = JSON.parse(fixed);
      console.log(`✓ 成功解析（候选 ${i + 1}/${candidates.length}，组合修复）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`候选 ${i + 1} 组合修复后解析失败:`, e.message);
      }
    }
  }

  console.error("========== 解析失败 ==========");
  console.error("原始输出前 500 字符:", raw.slice(0, 500));
  return null;
}

// ========== 测试用例 ==========

const testCases = [
  {
    name: "标准 JSON",
    input: '{"industry": "人工智能", "claims": [{"dimension": "市场规模", "claim": "test", "search_query": "test"}]}'
  },
  {
    name: "带 markdown 代码块",
    input: '```json\n{"industry": "人工智能", "claims": []}\n```'
  },
  {
    name: "带前后文字",
    input: '这是分析结果：\n{"industry": "人工智能", "claims": []}\n以上是我的分析。'
  },
  {
    name: "带尾逗号",
    input: '{"industry": "人工智能", "claims": [],}'
  },
  {
    name: "带注释",
    input: '{\n  "industry": "人工智能", // 行业\n  "claims": [] /* 诉求列表 */\n}'
  },
  {
    name: "混合问题",
    input: '好的，这是分析结果：\n```json\n{\n  "industry": "人工智能",\n  "claims": [],\n}\n```\n希望对你有帮助。'
  }
];

console.log("开始测试 JSON 解析功能...\n");

testCases.forEach((testCase, index) => {
  console.log(`\n测试 ${index + 1}: ${testCase.name}`);
  console.log("输入:", testCase.input.slice(0, 100));
  const result = extractJson(testCase.input);
  if (result) {
    console.log("✓ 解析成功:", JSON.stringify(result));
  } else {
    console.log("✗ 解析失败");
  }
  console.log("---");
});

console.log("\n测试完成！");
