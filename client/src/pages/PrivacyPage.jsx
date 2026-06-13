import React from "react";
import Seo from "../components/Seo";
import StaticPageLayout from "../components/StaticPageLayout";

export default function PrivacyPage() {
  return (
    <>
      <Seo
        title="隐私政策"
        description="垃圾BP过滤机隐私政策：我们如何收集、使用、存储与保护你上传的商业计划书及账户信息。"
        path="/privacy"
      />
      <StaticPageLayout title="隐私政策" updated="2026 年 6 月">
        <p>
          本隐私政策说明垃圾BP过滤机（以下简称"我们"）在你使用本服务时如何收集、使用、存储与保护你的信息。使用本服务即表示你同意本政策。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">一、我们收集的信息</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>账户信息：注册时提供的邮箱、联系方式等。</li>
          <li>上传内容：你为分析而上传的商业计划书（BP）、文档及相关材料。</li>
          <li>使用数据：访问日志、操作记录等用于保障服务安全与改进体验的技术信息。</li>
        </ul>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">二、信息的使用</h2>
        <p>
          我们仅将上述信息用于：向你提供 BP 分析、尽调与报告生成等核心功能；保障账户与平台安全；在你同意的范围内改进产品。我们不会将你上传的项目材料用于与你无关的用途。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">三、信息的存储与安全</h2>
        <p>
          我们采用合理的技术与管理措施保护你的数据，包括传输加密与访问控制。上传内容仅在为你提供服务所必需的范围内被处理与保留。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">四、第三方服务</h2>
        <p>
          为实现分析能力，本服务可能调用第三方大模型等技术服务。我们会尽合理努力选择具备相应安全与合规能力的服务方，并仅传递实现功能所必需的数据。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">五、你的权利</h2>
        <p>
          你有权访问、更正或删除你的账户信息与上传内容。如需行使上述权利或注销账户，请联系
          <a href="mailto:hello@garbagebpfilter.cn" className="text-[#1B4FD8]">
            hello@garbagebpfilter.cn
          </a>
          。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">六、政策更新</h2>
        <p>本政策可能不时更新，更新后将在本页公布。重大变更我们会通过适当方式通知你。</p>
      </StaticPageLayout>
    </>
  );
}
