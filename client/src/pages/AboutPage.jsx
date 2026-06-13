import React from "react";
import Seo from "../components/Seo";
import StaticPageLayout from "../components/StaticPageLayout";

const ABOUT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "垃圾BP过滤机",
  url: "https://www.garbagebpfilter.cn",
  email: "hello@garbagebpfilter.cn",
  description:
    "面向一级市场投资人的 AI 尽调工作台，用量化评分与多 Agent 协同辅助 BP 分析、尽职调查与投资决策。",
};

export default function AboutPage() {
  return (
    <>
      <Seo
        title="关于我们"
        description="垃圾BP过滤机是面向一级市场投资人的 AI 尽调工作台。我们用量化评分体系与多 Agent 协同，帮助投资人更快、更有据地判断每一个项目。"
        path="/about"
        jsonLd={ABOUT_JSON_LD}
      />
      <StaticPageLayout title="关于我们">
        <p>
          <strong>垃圾BP过滤机</strong>是一款面向一级市场投资人（VC / PE）的 AI
          尽调工作台。我们相信，投资人的时间应该花在思考与发掘好项目上，而不是淹没在堆积如山的商业计划书里。
        </p>
        <p>
          我们用一套独创的<strong>量化评分体系</strong>，从团队、市场、产品、商业模式、财务等多个维度对每一份
          BP 进行结构化评估；并让 AI <strong>逐条核查与击破其中的虚假陈述与逻辑漏洞</strong>，把"看起来很美"的故事还原成可被验证的事实。
        </p>
        <p>
          在分析之外，我们用<strong>多 Agent 协同</strong>覆盖从初筛、尽职调查到投资备忘录撰写的全链路，让繁琐的
          paperwork 交给 AI，把最终的判断权留给投资人自己。
        </p>
        <p>
          有任何合作或反馈，欢迎联系我们：
          <a href="mailto:hello@garbagebpfilter.cn" className="text-[#1B4FD8]">
            hello@garbagebpfilter.cn
          </a>
          。
        </p>
      </StaticPageLayout>
    </>
  );
}
