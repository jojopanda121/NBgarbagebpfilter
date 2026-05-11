import DOMPurify from 'dompurify';

// ── Markdown 简易渲染（带 XSS 防护）──
export function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  // 配置 DOMPurify：只允许 strong 标签和 class 属性
  const sanitizeConfig = {
    ALLOWED_TAGS: ['strong'],
    ALLOWED_ATTR: ['class']
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} className="text-xl font-bold mt-6 mb-3 text-[#0D2145]">
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="text-lg font-bold mt-5 mb-2 text-[#0D2145]">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="text-base font-semibold mt-4 mb-2 text-[#0F1C36]">
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("**") && line.endsWith("**")) {
      elements.push(
        <p key={i} className="font-bold mt-4 mb-1 text-[#0F1C36]">
          {line.replace(/\*\*/g, "")}
        </p>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const htmlContent = line
        .slice(2)
        .replace(
          /\*\*(.*?)\*\*/g,
          '<strong class="text-[#0D2145]">$1</strong>'
        );
      const sanitizedHtml = DOMPurify.sanitize(htmlContent, sanitizeConfig);

      elements.push(
        <div key={i} className="flex gap-2 ml-4 my-0.5">
          <span className="text-[#5B677A] shrink-0">•</span>
          <span
            className="text-[#0F1C36]"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      const htmlContent = line.replace(
        /\*\*(.*?)\*\*/g,
        '<strong class="text-[#0D2145]">$1</strong>'
      );
      const sanitizedHtml = DOMPurify.sanitize(htmlContent, sanitizeConfig);

      elements.push(
        <p
          key={i}
          className="text-[#0F1C36] my-1 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      );
    }
    i++;
  }
  return elements;
}
