import React from "react";
import Seo from "../components/Seo";
import StaticPageLayout from "../components/StaticPageLayout";

export default function TermsPage() {
  return (
    <>
      <Seo
        title="服务条款"
        description="垃圾BP过滤机服务条款：使用本 AI 尽调工作台的权利、义务与责任边界。"
        path="/terms"
      />
      <StaticPageLayout title="服务条款" updated="2026 年 6 月">
        <p>
          欢迎使用垃圾BP过滤机（以下简称"本服务"）。在使用本服务前，请仔细阅读并同意以下条款。注册或使用本服务即视为你接受本条款。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">一、服务内容</h2>
        <p>
          本服务为一级市场投资人提供基于 AI 的 BP 分析、尽职调查辅助与投资文档生成等功能。分析结果由算法与大模型生成，仅供参考，不构成任何投资建议或决策依据。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">二、账户与使用</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>你应对账户下的所有活动负责，并妥善保管登录凭证。</li>
          <li>你承诺仅上传你有权处理的材料，不得上传违法或侵犯他人权利的内容。</li>
          <li>不得利用本服务从事任何违反法律法规或干扰服务正常运行的行为。</li>
        </ul>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">三、知识产权</h2>
        <p>
          你保留对自己上传内容的全部权利。本服务的软件、界面、评分体系及相关算法的知识产权归我们所有，未经许可不得复制或商用。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">四、免责声明</h2>
        <p>
          本服务按"现状"提供。我们不对分析结果的准确性、完整性或适用性作出保证。因依赖分析结果作出的任何投资决策及其后果，由你自行承担。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">五、条款变更与终止</h2>
        <p>
          我们可能不时修订本条款，修订后将在本页公布。我们保留在你违反条款时暂停或终止服务的权利。
        </p>

        <h2 className="text-xl font-semibold text-[#0D2145] pt-2">六、联系我们</h2>
        <p>
          如对本条款有任何疑问，请联系
          <a href="mailto:hello@garbagebpfilter.cn" className="text-[#1B4FD8]">
            hello@garbagebpfilter.cn
          </a>
          。
        </p>
      </StaticPageLayout>
    </>
  );
}
