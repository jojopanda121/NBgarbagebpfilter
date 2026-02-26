import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Gavel, ArrowLeft, Loader2 } from "lucide-react";
import api from "../services/api";
import VerdictCard from "../components/VerdictCard";
import ScoreVisualizer from "../components/ScoreVisualizer";
import DetailedReport from "../components/DetailedReport";

export default function ReportPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    async function fetchReport() {
      if (!taskId) {
        setError("缺少任务 ID");
        setLoading(false);
        return;
      }

      try {
        const data = await api.get(`/api/task/${taskId}`);
        if (!data || !data.result) {
          setError("报告不存在或尚未生成");
          return;
        }
        // 解析 result 字符串
        const parsed = typeof data.result === "string" ? JSON.parse(data.result) : data.result;
        setResult(parsed);
      } catch (err) {
        setError(err.message || "获取报告失败");
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, [taskId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 bg-gray-800 rounded-lg"
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate("/")}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Gavel className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">垃圾BP过滤机</span>
          </div>

          <button
            onClick={() => navigate("/app/dashboard")}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            分析新 BP
          </button>
        </div>
      </header>

      {/* 返回按钮 */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <button
          onClick={() => navigate("/app/history")}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回历史报告
        </button>
      </div>

      {/* 报告内容 */}
      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* 公司信息 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">
            {result.extracted_data?.company_name || "商业计划书分析"}
          </h1>
          <p className="text-gray-400">
            {result.industry} · {result.extracted_data?.product_name}
          </p>
        </div>

        {/* 评分结果 */}
        <VerdictCard result={result} />

        {/* 五维雷达图 */}
        <div className="mt-6">
          <ScoreVisualizer verdict={result.verdict} />
        </div>

        {/* 详细报告 */}
        <div className="mt-6">
          <DetailedReport result={result} />
        </div>
      </main>
    </div>
  );
}
