import React from "react";

export default function TabNavigation({ tabs, activeTab, setActiveTab }) {
  return (
    <div className="flex gap-2 mb-6 border-b border-[#EEF1F7] pb-4 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
            activeTab === tab.key
              ? "bg-[#1B4FD8] text-[#0D2145]"
              : "text-[#4B5A72] hover:text-[#0D2145] hover:bg-[#EEF1F7]"
          }`}
          aria-label={tab.label}
        >
          <tab.icon className="w-4 h-4" aria-hidden="true" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
