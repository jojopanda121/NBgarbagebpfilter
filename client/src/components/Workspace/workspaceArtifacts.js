import {
  ClipboardList, FileText, Image as ImageIcon, MessageSquare,
  Presentation, Share2, Table2,
} from "lucide-react";

export const GENERATED_ARTIFACT_KINDS = new Set([
  "generated_pptx",
  "generated_docx",
  "generated_xlsx",
  "generated_image",
  "pptx",
  "docx",
  "xlsx",
]);

export const DOWNLOADABLE_KINDS = new Set([
  "pptx",
  "docx",
  "xlsx",
  "generated_pptx",
  "generated_docx",
  "generated_xlsx",
  "generated_image",
]);

export const ARTIFACT_KIND_LABEL = {
  generated_pptx: "AI 生成 PPT",
  generated_docx: "AI 生成 Word",
  generated_xlsx: "AI 生成 Excel",
  generated_image: "AI 生成信息图",
  pptx: "AI 生成 PPT",
  docx: "AI 生成 Word",
  xlsx: "AI 生成 Excel",
  upload: "上传",
};

export const STANDARD_SKILL_IDS = new Set([
  "onepager_pptx",
  "dd_checklist_xlsx",
  "founder_interview_docx",
  "competitor_matrix_xlsx",
  "ic_questions_xlsx",
]);

export const STANDARD_SKILL_ORDER = [
  "onepager_pptx",
  "dd_checklist_xlsx",
  "founder_interview_docx",
  "competitor_matrix_xlsx",
  "ic_questions_xlsx",
];

export const SKILL_META = {
  onepager_pptx: { icon: Presentation, tone: "text-blue-700", hint: "PPT" },
  investment_snapshot: { icon: FileText, tone: "text-rose-700", hint: "PPT" },
  highlight_visual: { icon: ImageIcon, tone: "text-fuchsia-700", hint: "JPEG" },
  project_brief: { icon: Presentation, tone: "text-blue-700", hint: "PPT" },
  investment_deck_pptx: { icon: ClipboardList, tone: "text-blue-700", hint: "PPT" },
  dd_checklist_xlsx: { icon: Table2, tone: "text-emerald-700", hint: "XLSX" },
  founder_interview_docx: { icon: MessageSquare, tone: "text-indigo-700", hint: "DOCX" },
  competitor_matrix_xlsx: { icon: Table2, tone: "text-cyan-700", hint: "XLSX" },
  ic_questions_xlsx: { icon: ClipboardList, tone: "text-amber-700", hint: "XLSX" },
  teaser_share: { icon: Share2, tone: "text-slate-700", hint: "Link" },
};

export function isGeneratedArtifact(artifact) {
  return GENERATED_ARTIFACT_KINDS.has(artifact?.kind);
}

export function isImageArtifact(artifact) {
  const mime = artifact?.mimeType || artifact?.mime_type || "";
  return artifact?.kind === "generated_image" || mime.startsWith("image/");
}

export function isDownloadableArtifact(artifact) {
  if (!artifact) return false;
  if (DOWNLOADABLE_KINDS.has(artifact.kind)) return true;
  const mime = artifact.mimeType || artifact.mime_type || "";
  return Boolean(artifact.bufferBase64 || mime.includes("officedocument") || mime.startsWith("image/"));
}

export function artifactOutputHint(skill) {
  const kind = skill?.outputArtifactKind || "";
  if (kind === "pptx") return "PPT";
  if (kind === "docx") return "DOCX";
  if (kind === "xlsx") return "XLSX";
  if (kind === "json") return "JSON";
  if (kind === "link") return "Link";
  return "Skill";
}

export function enrichPreviewArtifact(artifact, projectId) {
  if (!artifact || !projectId) return artifact;
  const artifactId = artifact.workspaceArtifactId || artifact.workspace_artifact_id || artifact.id;
  if (!artifactId || !isImageArtifact(artifact)) return artifact;
  return {
    ...artifact,
    previewUrl: `/api/workspace-projects/${projectId}/conversation/artifacts/${artifactId}/download`,
  };
}
