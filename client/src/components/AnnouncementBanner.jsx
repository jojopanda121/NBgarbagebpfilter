import React, { useState, useEffect } from "react";
import { Megaphone, X } from "lucide-react";
import api from "../services/api";

const TYPE_STYLES = {
  info: "bg-blue-500/10 border-blue-500/30 text-blue-300",
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
};

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState([]);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("dismissed_announcements") || "[]");
    } catch { return []; }
  });

  useEffect(() => {
    api.get("/api/announcement/active")
      .then((data) => setAnnouncements(data.announcements || []))
      .catch(() => {});
  }, []);

  const dismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    sessionStorage.setItem("dismissed_announcements", JSON.stringify(next));
  };

  const visible = announcements.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-0">
      {visible.map((a) => (
        <div
          key={a.id}
          className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b ${TYPE_STYLES[a.type] || TYPE_STYLES.info}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Megaphone className="w-4 h-4 shrink-0" />
            <p className="text-sm truncate">{a.content}</p>
          </div>
          <button
            onClick={() => dismiss(a.id)}
            className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
