import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Loader2, Trash2, XCircle } from "lucide-react";
import api from "../../services/api";

/**
 * MyModelTab —— 「设置 → 我的模型」
 *
 * 用户可以填自己的模型 API Key，之后在分析页勾选"使用我自己的模型"，
 * 算力由用户自己付，不消耗平台额度。
 *
 * 关键交互约束：**保存前必须通过连接测试**。后端会用真实调用链跑一个最小
 * 结构化任务，确认这个模型不仅能应答、还能按 JSON Schema 输出——做不到的
 * 模型接进流水线只会让分析跑到一半失败，用户还会以为是平台的问题。
 */
export default function MyModelTab() {
  const [meta, setMeta] = useState(null); // /api/llm/providers
  const [credential, setCredential] = useState(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [models, setModels] = useState({ default: "", heavy: "", light: "" });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(""); // "" | "validate" | "save" | "delete"
  const [feedback, setFeedback] = useState(null); // { ok, message, warnings? }

  const currentProvider = useMemo(
    () => (meta?.providers || []).find((p) => p.id === provider) || null,
    [meta, provider]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [providersResp, credResp] = await Promise.all([
        api.getLlmProviders(),
        api.getLlmCredential().catch(() => ({ credential: null })),
      ]);
      setMeta(providersResp);
      setCredential(credResp?.credential || null);
      const initial = credResp?.credential?.provider || providersResp?.providers?.[0]?.id || "";
      setProvider(initial);
      if (credResp?.credential) {
        setBaseURL(credResp.credential.base_url || "");
        setModels({
          default: credResp.credential.models?.default || "",
          heavy: credResp.credential.models?.heavy || "",
          light: credResp.credential.models?.light || "",
        });
      }
    } catch (err) {
      setFeedback({ ok: false, message: err.message || "加载失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 切换厂商时把模型名重置成该厂商的推荐值，省得用户手填
  const onProviderChange = (id) => {
    setProvider(id);
    const p = (meta?.providers || []).find((x) => x.id === id);
    setModels({ default: p?.defaultModels?.default || "", heavy: "", light: "" });
    setBaseURL("");
    setFeedback(null);
  };

  const buildPayload = () => ({
    provider,
    apiKey,
    baseURL: baseURL.trim(),
    models: {
      default: models.default.trim() || currentProvider?.defaultModels?.default || "",
      heavy: models.heavy.trim(),
      light: models.light.trim(),
    },
  });

  const handleValidate = async () => {
    setBusy("validate");
    setFeedback(null);
    try {
      const res = await api.validateLlmCredential(buildPayload());
      setFeedback({ ok: res.ok, message: res.message, warnings: res.detail?.warnings || [] });
    } catch (err) {
      setFeedback({ ok: false, message: err.message || "测试失败" });
    } finally {
      setBusy("");
    }
  };

  const handleSave = async () => {
    setBusy("save");
    setFeedback(null);
    try {
      const res = await api.saveLlmCredential(buildPayload());
      setCredential(res.credential);
      setApiKey("");
      setFeedback({
        ok: true,
        message: "已保存。现在可以在分析页选择「使用我自己的模型」。",
        warnings: res.validation?.detail?.warnings || [],
      });
    } catch (err) {
      setFeedback({ ok: false, message: err.message || "保存失败" });
    } finally {
      setBusy("");
    }
  };

  const handleDelete = async () => {
    setBusy("delete");
    try {
      await api.deleteLlmCredential();
      setCredential(null);
      setApiKey("");
      setFeedback({ ok: true, message: "已删除。分析将回到平台模型。" });
    } catch (err) {
      setFeedback({ ok: false, message: err.message || "删除失败" });
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-[#D8DCE8] rounded-xl p-8 flex items-center justify-center gap-2 text-[#8E9BB0]">
        <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
      </div>
    );
  }

  if (!meta?.byok_enabled) {
    return (
      <div className="bg-white border border-[#D8DCE8] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#0D2145] mb-1">自带模型</h3>
        <p className="text-xs text-[#8E9BB0]">
          {meta?.byok_disabled_reason || "该功能当前不可用。"}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#D8DCE8] rounded-xl p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[#0D2145] flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[#1B4FD8]" /> 我的模型
        </h3>
        <p className="text-xs text-[#8E9BB0] mt-1 leading-relaxed">
          填入你自己的模型 API Key 后，可以在分析时选择用自己的模型跑。 算力费用由你的账户承担，
          <span className="text-emerald-600 font-medium">不消耗平台分析次数</span>。 Key 以
          AES-256-GCM 加密存储，平台不会明文保存或记录。
        </p>
      </div>

      {/* 已保存的凭证 */}
      {credential && (
        <div className="rounded-lg border border-[#D8DCE8] bg-[#F7F9FC] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-[#4B5A72] space-y-1">
              <div>
                <span className="text-[#8E9BB0]">当前配置：</span>
                <span className="font-medium text-[#0D2145]">
                  {(meta.providers.find((p) => p.id === credential.provider) || {}).label ||
                    credential.provider}
                </span>
                <span className="mx-1.5 text-[#BFC5D6]">·</span>
                <span className="font-mono">{credential.models?.default || "默认模型"}</span>
              </div>
              <div>
                <span className="text-[#8E9BB0]">API Key：</span>
                <span className="font-mono">{credential.api_key_masked}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {credential.usable ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-600">连接正常，可用于分析</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-red-500">
                      {credential.last_validation_message || "未通过校验，暂不可用"}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={handleDelete}
              disabled={!!busy}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> 删除
            </button>
          </div>
        </div>
      )}

      {/* 表单 */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-[#4B5A72] mb-1.5">模型厂商</label>
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#D8DCE8] bg-white text-[#0D2145] focus:outline-none focus:border-[#1B4FD8]"
          >
            {meta.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {currentProvider?.consoleUrl && (
            <p className="text-[11px] text-[#8E9BB0] mt-1">
              在{" "}
              <a
                href={currentProvider.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#1B4FD8] hover:underline"
              >
                厂商控制台
              </a>{" "}
              申请 API Key
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs text-[#4B5A72] mb-1.5">
            API Key{" "}
            {credential && <span className="text-[#8E9BB0]">（留空则不修改已保存的 Key）</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={credential ? "如需更换请填入新的 Key" : "粘贴你的 API Key"}
            autoComplete="off"
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#D8DCE8] bg-white text-[#0D2145] font-mono focus:outline-none focus:border-[#1B4FD8]"
          />
        </div>

        <div>
          <label className="block text-xs text-[#4B5A72] mb-1.5">模型名称</label>
          <input
            value={models.default}
            onChange={(e) => setModels((m) => ({ ...m, default: e.target.value }))}
            placeholder={currentProvider?.defaultModels?.default || ""}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#D8DCE8] bg-white text-[#0D2145] font-mono focus:outline-none focus:border-[#1B4FD8]"
          />
          {currentProvider?.suggestedModels?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {currentProvider.suggestedModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModels((prev) => ({ ...prev, default: m }))}
                  className="px-2 py-0.5 text-[11px] rounded border border-[#D8DCE8] text-[#4B5A72] hover:border-[#1B4FD8] hover:text-[#1B4FD8] font-mono"
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs text-[#1B4FD8] hover:underline"
        >
          {showAdvanced ? "收起高级选项" : "高级选项（分档模型 / 自定义接口地址）"}
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-lg bg-[#F7F9FC] border border-[#D8DCE8] p-3">
            <p className="text-[11px] text-[#8E9BB0] leading-relaxed">
              重任务（投决材料、IC
              问题清单）与轻任务（一页纸、Teaser）可以走不同模型省钱。留空则全部使用上面的模型。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#4B5A72] mb-1">重任务模型</label>
                <input
                  value={models.heavy}
                  onChange={(e) => setModels((m) => ({ ...m, heavy: e.target.value }))}
                  placeholder="留空 = 同上"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#D8DCE8] bg-white font-mono focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#4B5A72] mb-1">轻任务模型</label>
                <input
                  value={models.light}
                  onChange={(e) => setModels((m) => ({ ...m, light: e.target.value }))}
                  placeholder="留空 = 同上"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#D8DCE8] bg-white font-mono focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-[#4B5A72] mb-1">
                接口地址
                {!meta.allow_custom_endpoint && (
                  <span className="text-[#8E9BB0]">（仅限厂商官方域名）</span>
                )}
              </label>
              <input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="留空 = 厂商默认端点"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#D8DCE8] bg-white font-mono focus:outline-none focus:border-[#1B4FD8]"
              />
            </div>
          </div>
        )}
      </div>

      {/* 结果反馈 */}
      {feedback && (
        <div
          className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
            feedback.ok
              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-red-50 border border-red-200 text-red-600"
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1.5">
            <p>{feedback.message}</p>
            {feedback.warnings?.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-current/15">
                {feedback.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleValidate}
          disabled={!!busy || !apiKey}
          className="px-4 py-2 text-sm rounded-lg border border-[#D8DCE8] text-[#4B5A72] hover:border-[#1B4FD8] hover:text-[#1B4FD8] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          {busy === "validate" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          测试连接
        </button>
        <button
          onClick={handleSave}
          disabled={!!busy || !apiKey}
          className="px-4 py-2 text-sm rounded-lg bg-[#1B4FD8] text-white hover:bg-[#1642B8] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          {busy === "save" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          校验并保存
        </button>
      </div>
      <p className="text-[11px] text-[#8E9BB0] leading-relaxed">
        保存会先用你的 Key 真实调用一次模型，确认它能按结构化格式输出。 测不通的模型不会被保存 ——
        否则分析会在中途失败。
      </p>
    </div>
  );
}
