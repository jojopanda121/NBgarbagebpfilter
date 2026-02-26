import React from "react";

export default function TabNavigation({ tabs, activeTab, setActiveTab }) {
  return (
    <div className="flex gap-2 mb-6 border-b border-gray-800 pb-4 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
            activeTab === tab.key
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-800"
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
