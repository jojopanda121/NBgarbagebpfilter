// ============================================================
// ShareToForumModal — 把一次分析结果"一键转发到论坛"
//
// 流程：
//   1) 选披露级别（项目名/公司名两个独立开关）
//   2) 实时预览脱敏后的评分快照（preview-snapshot）
//   3) 填标题/正文/是否开放撮合/可选公开联系方式
//   4) 发布 → 跳转到帖子
//
// 红线提示：分数由平台快照，不可改；风险旗标强制展示。
// ============================================================
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { X, Loader2, ShieldCheck } from "lucide-react";
import forumApi from "../../services/forumApi";
import ScoreSnapshotCard from "./ScoreSnapshotCard";
import ForumDisclaimer from "./ForumDisclaimer";
import AttachmentUploader from "./AttachmentUploader";

export default function ShareToForumModal({ taskId, defaultTitle = "", onClose }) {
  const navigate = useNavigate();
  const [showProjectName, setShowProjectName] = useState(false);
  const [showCompanyName, setShowCompanyName] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [allowContact, setAllowContact] = useState(true);
  const [publicContact, setPublicContact] = useState("");

  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const refreshPreview = useCallback(async () => {
    setPreviewing(true);
    setError("");
    try {
      const r = await forumApi.previewSnapshot({ taskId, showProjectName, showCompanyName });
      setPreview(r);
    } catch (e) {
      setError(e.message || "预览失败");
    } finally {
      setPreviewing(false);
    }
  }, [taskId, showProjectName, showCompanyName]);

  useEffect(() => {
    refreshPreview();
  }, [refreshPreview]);

  async function handleSubmit() {
    if (!title.trim()) {
      setError("请填写标题");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const post = await forumApi.createPost({
        category: "project",
        title: title.trim(),
        body,
        task_id: taskId,
        show_project_name: showProjectName,
        show_company_name: showCompanyName,
        allow_contact: allowContact,
        public_contact: publicContact.trim() || undefined,
        attachments: attachments.length ? attachments : undefined,
      });
      onClose?.();
      navigate(`/forum/post/${post.id}`);
    } catch (e) {
      setError(e.message || "发布失败");
    } finally {
      setSubmitting(false);
    }
  }

  const disclosureLabel =
    showProjectName && showCompanyName
      ? "完全公开"
      : showProjectName || showCompanyName
        ? "半披露"
        : "完全匿名";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#EEF1F7]">
          <div className="text-sm font-semibold text-[#0D2145]">转发到论坛</div>
          <button onClick={onClose} className="text-[#8E9BB0] hover:text-[#0F1C36]">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
              {error}
            </div>
          )}

          {/* 披露级别 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-[#0D2145]">隐私披露</div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-[#EEF1F7] text-[#4B5A72]">
                {disclosureLabel}
              </span>
            </div>
            <div className="space-y-1.5">
              <Toggle
                checked={showProjectName}
                onChange={setShowProjectName}
                label="披露项目 / 产品名"
                hint="关闭则用代号（如 Project Helios）替代"
              />
              <Toggle
                checked={showCompanyName}
                onChange={setShowCompanyName}
                label="披露公司名"
                hint="关闭则替换为「某公司」"
              />
            </div>
            <p className="text-[11px] text-[#8E9BB0] mt-2">
              评分、亮点、风险由平台实测生成，<b>风险旗标强制展示、不可隐藏</b>
              ；可识别信息按上方开关自动脱敏。
            </p>
          </section>

          {/* 快照预览 */}
          <section>
            <div className="text-xs font-semibold text-[#0D2145] mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#0F8A5F]" /> 论坛将展示的评分快照（预览）
            </div>
            {previewing ? (
              <div className="flex items-center gap-2 text-xs text-[#8E9BB0] py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> 正在生成脱敏预览…
              </div>
            ) : (
              <ScoreSnapshotCard score={preview?.snapshot} />
            )}
          </section>

          {/* 标题 / 正文 */}
          <section className="space-y-2.5 text-sm">
            <label className="block">
              <div className="text-xs text-[#0D2145] mb-1">标题 *</div>
              <input
                className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="一句话说清亮点，如：金融科技项目跑出 87 分，寻 A 轮投资人"
              />
            </label>
            <label className="block">
              <div className="text-xs text-[#0D2145] mb-1">补充说明（选填）</div>
              <textarea
                className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm h-24 resize-none"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={20000}
                placeholder="可补充融资进展、想找什么样的投资人等。注意：正文也会做公司名/项目名脱敏兜底。"
              />
            </label>

            {/* 附件（选填）。注意：附件不做自动脱敏，匿名/半披露时需发帖人自行把关 */}
            <div>
              <div className="text-xs text-[#0D2145] mb-1">附件（选填）</div>
              <AttachmentUploader
                value={attachments}
                onChange={setAttachments}
                scope="post"
                disabled={submitting}
              />
              <p className="text-[11px] text-[#C2410C] mt-1.5">
                附件<b>不会自动脱敏</b>，仅登录用户可见。
                {disclosureLabel !== "完全公开" &&
                  "当前为脱敏发帖，请勿上传含公司/项目名的文件（如原始 BP、Logo）。"}
              </p>
            </div>
          </section>

          {/* 撮合设置 */}
          <section className="space-y-2">
            <Toggle
              checked={allowContact}
              onChange={setAllowContact}
              label="开放撮合"
              hint="允许投资人/FA 点「我有兴趣」与你建立联系"
            />
            <label className="block">
              <div className="text-xs text-[#0D2145] mb-1">在帖内直接公开联系方式（选填）</div>
              <input
                className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
                value={publicContact}
                onChange={(e) => setPublicContact(e.target.value)}
                maxLength={500}
                placeholder="如微信/邮箱。留空则只走「我有兴趣 → 授权」换名片"
              />
            </label>
          </section>

          <ForumDisclaimer variant="inline" />
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#EEF1F7]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || previewing}
            className="px-5 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            发布到论坛
          </button>
        </footer>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 text-left px-3 py-2 rounded-lg border border-[#EEF1F7] hover:border-[#D8DCE8]"
    >
      <div className="min-w-0">
        <div className="text-sm text-[#0D2145]">{label}</div>
        {hint && <div className="text-[11px] text-[#8E9BB0]">{hint}</div>}
      </div>
      <span
        className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${checked ? "bg-[#1B4FD8]" : "bg-[#D8DCE8]"}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}
