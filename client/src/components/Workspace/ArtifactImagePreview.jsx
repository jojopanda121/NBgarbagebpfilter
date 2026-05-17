import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import api from "../../services/api";

export default function ArtifactImagePreview({
  url,
  alt,
  className = "mt-2",
  loadingClassName = "h-24",
  showFailureText = true,
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setSrc("");
    setFailed(false);
    api.getBlob(url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (failed) {
    return showFailureText
      ? <p className={`${className} text-xs text-[#8E9BB0]`}>图片预览加载失败，可直接下载查看。</p>
      : null;
  }

  if (!src) {
    return (
      <div className={`${className} flex ${loadingClassName} items-center justify-center rounded-md border border-[#EEF1F7] bg-[#F7F8FC]`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#8E9BB0]" />
      </div>
    );
  }

  return (
    <div className={`${className} overflow-hidden rounded-md border border-[#EEF1F7] bg-[#F7F8FC]`}>
      <img src={src} alt={alt || "信息图预览"} className="block w-full object-contain" />
    </div>
  );
}
