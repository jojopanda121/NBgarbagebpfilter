import React from "react";
import { CheckCircle, AlertCircle } from "lucide-react";

export default function MessageAlert({ message }) {
  if (!message) return null;

  return (
    <div
      className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
        message.type === "success"
          ? "bg-green-500/10 text-green-400 border border-green-500/20"
          : "bg-red-500/10 text-red-400 border border-red-500/20"
      }`}
    >
      {message.type === "success" ? (
        <CheckCircle className="w-4 h-4" />
      ) : (
        <AlertCircle className="w-4 h-4" />
      )}
      {message.text}
    </div>
  );
}
