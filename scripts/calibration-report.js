#!/usr/bin/env node
/**
 * calibration-report.js — 诊断式校准 CLI（管理员/GP 侧，离线）
 *
 * ⚠️ 仅管理员/GP 使用：能跑此脚本 = 有服务器 shell 权限。打标签直接影响是否把
 *    SCORING_AGG 切 on（改的是所有人的分），不开放给普通用户。
 *
 * 用法（在仓库根目录）：
 *   node scripts/calibration-report.js list [--unlabeled] [--limit 30]   # 看归档记录、找没标的
 *   node scripts/calibration-report.js label <taskId> <投|观望|放弃>      # GP 打真实标签
 *   node scripts/calibration-report.js report [--live] [--version v4.7.0] # 出诊断报告（默认量新聚合分）
 *
 * 达标线（report 输出会逐项对照）：
 *   排序吻合度 tau ≥ 0.6；系统性偏差 ordering_ok = true；高频规则无"偏见候选"。
 *   达标 + 标杆回归全绿 + 无粗暴反转 → 可把 SCORING_AGG=on。
 */
const path = require("path");
require(path.join(__dirname, "..", "server", "node_modules", "dotenv"))
  .config({ path: path.join(__dirname, "..", ".env") });

const calib = require(path.join(__dirname, "..", "server", "services", "calibrationService"));

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true) : def;
}

const PASS = { tau: 0.6 };

function cmdList() {
  const onlyUnlabeled = process.argv.includes("--unlabeled");
  const limit = parseInt(arg("--limit", "30"), 10);
  const rows = calib.listRecent({ limit, onlyUnlabeled });
  if (!rows.length) { console.log("（无归档记录。先在 shadow 模式跑几个 BP，recordJudgment 会自动归档。）"); return; }
  console.log(`\n最近 ${rows.length} 条归档${onlyUnlabeled ? "（未标注）" : ""}：\n`);
  for (const r of rows) {
    console.log(
      `#${String(r.id).padStart(4)}  task=${String(r.task_id || "-").slice(0, 18).padEnd(18)}  ` +
      `${String(r.project_name || "-").slice(0, 20).padEnd(20)}  live=${String(r.total_score).padStart(3)} ${r.grade || "-"}  ` +
      `basis=${(r.scoring_agg_basis || "-").padEnd(12)}  label=${r.gp_label || "（未标）"}`
    );
  }
  console.log("");
}

function cmdLabel() {
  const taskId = process.argv[3];
  const label = process.argv[4];
  const VALID = ["投", "观望", "放弃", "fast_track", "dd", "watch", "pass"];
  if (!taskId || !label) { console.error("用法: node scripts/calibration-report.js label <taskId> <投|观望|放弃>"); process.exit(1); }
  if (!VALID.includes(label)) { console.error(`label 必须是: ${VALID.join(" | ")}`); process.exit(1); }
  const ok = calib.setGpLabel({ taskId, label });
  console.log(ok ? `✓ 已标注 task=${taskId} → ${label}` : `✗ 标注失败（task=${taskId} 不存在？）`);
}

function fmt(v) { return v == null ? "—" : v; }

function cmdReport() {
  const useShadow = !process.argv.includes("--live"); // 默认量新聚合分（切 on 前该看的）
  const version = arg("--version", null);
  const rep = calib.runDiagnostics({ useShadow, pipelineVersion: version });

  console.log("\n══════════ 诊断式校准报告 ══════════");
  console.log(`量的分数: ${rep.scored_by}`);
  console.log(`样本: 总归档 ${rep.total_records}，已标注 ${rep.labeled_records}`);
  if (rep.labeled_records < 30) {
    console.log(`⚠ 已标注样本 < 30，统计噪声大，结论不可信。继续在 shadow 攒样本+标注。`);
  }

  const rc = rep.ranking_concordance;
  const tauOk = rc.tau != null && rc.tau >= PASS.tau;
  console.log(`\n[1] 排序吻合度 (Kendall τ): ${fmt(rc.tau)}  达标线 ≥${PASS.tau}  → ${tauOk ? "✓达标" : "✗未达标"}`);
  console.log(`    一致对 ${rc.concordant} / 相反对 ${rc.discordant} / 平局 ${rc.ties}`);

  const sb = rep.systematic_bias;
  console.log(`\n[2] 系统性偏差 ordering_ok: ${sb.ordering_ok ? "✓ 投>观望>放弃 均分序正确" : "✗ 均分序错乱（暴露偏差）"}`);
  for (const [label, s] of Object.entries(sb.by_label)) {
    console.log(`    ${label.padEnd(6)} n=${s.n}  均分=${fmt(s.mean)}`);
  }

  const rb = rep.rule_backtest;
  const biasTags = Object.entries(rb.by_tag).filter(([, t]) => t.verdict === "偏见候选" && t.triggered >= 3);
  console.log(`\n[3] 规则回测（全样本均偏好序 ${fmt(rb.overall_mean_rank)}）：`);
  for (const [tag, t] of Object.entries(rb.by_tag)) {
    console.log(`    ${tag.padEnd(34)} 触发${String(t.triggered).padStart(3)}  lift=${fmt(t.lift)}  ${t.verdict}`);
  }
  const noBias = biasTags.length === 0;
  console.log(`    高频"偏见候选"规则: ${noBias ? "✓ 无" : "✗ " + biasTags.map(([k]) => k).join(", ")}`);

  const passed = tauOk && sb.ordering_ok && noBias && rep.labeled_records >= 30;
  console.log(`\n══════════ 达标结论 ══════════`);
  console.log(passed
    ? "✓ 诊断达标。再确认①标杆回归 npx jest scoringBenchmarks 全绿 ②无粗暴反转（GP想投的没打D），即可 SCORING_AGG=on。"
    : "✗ 未达标。按上面失败项手改 server/config/scoringTables.js 的可解释参数（权重/阈值），回 shadow 再攒——不要自动反解。");
  console.log("");
}

const cmd = process.argv[2] || "report";
try {
  if (cmd === "list") cmdList();
  else if (cmd === "label") cmdLabel();
  else if (cmd === "report") cmdReport();
  else { console.error(`未知命令: ${cmd}。支持: list | label | report`); process.exit(1); }
} catch (err) {
  console.error("执行失败:", err.message);
  process.exit(1);
}
