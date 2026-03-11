import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { MapChart } from "echarts/charts";
import {
  TooltipComponent,
  VisualMapComponent,
  GeoComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([MapChart, TooltipComponent, VisualMapComponent, GeoComponent, CanvasRenderer]);

// 省份名称映射（API返回的短名 -> GeoJSON 中的全名）
const PROVINCE_NAME_MAP = {
  "北京": "北京市", "天津": "天津市", "上海": "上海市", "重庆": "重庆市",
  "河北": "河北省", "山西": "山西省", "辽宁": "辽宁省", "吉林": "吉林省",
  "黑龙江": "黑龙江省", "江苏": "江苏省", "浙江": "浙江省", "安徽": "安徽省",
  "福建": "福建省", "江西": "江西省", "山东": "山东省", "河南": "河南省",
  "湖北": "湖北省", "湖南": "湖南省", "广东": "广东省", "海南": "海南省",
  "四川": "四川省", "贵州": "贵州省", "云南": "云南省", "陕西": "陕西省",
  "甘肃": "甘肃省", "青海": "青海省", "台湾": "台湾省", "内蒙古": "内蒙古自治区",
  "广西": "广西壮族自治区", "西藏": "西藏自治区", "宁夏": "宁夏回族自治区",
  "新疆": "新疆维吾尔自治区", "香港": "香港特别行政区", "澳门": "澳门特别行政区",
};

// 反向映射（GeoJSON 全名 -> 短名）
const PROVINCE_REVERSE_MAP = Object.fromEntries(
  Object.entries(PROVINCE_NAME_MAP).map(([short, full]) => [full, short])
);

export default function ChinaMap({ provinces = [], details = {}, onProvinceClick }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [mapRegistered, setMapRegistered] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // 注册中国地图
  useEffect(() => {
    let cancelled = false;
    async function loadMap() {
      if (echarts.getMap("china")) {
        setMapRegistered(true);
        return;
      }
      try {
        const resp = await fetch("/china.json");
        if (!resp.ok) throw new Error("Failed to load china.json");
        const geoJson = await resp.json();
        if (!cancelled) {
          echarts.registerMap("china", geoJson);
          setMapRegistered(true);
        }
      } catch (err) {
        console.warn("China map load failed:", err);
        if (!cancelled) setLoadError(true);
      }
    }
    loadMap();
    return () => { cancelled = true; };
  }, []);

  // 初始化图表
  useEffect(() => {
    if (!mapRegistered || !chartRef.current) return;

    const chart = echarts.init(chartRef.current, "dark");
    chartInstance.current = chart;

    // 构建数据：将 API 短名映射到 GeoJSON 全名
    const dataMap = {};
    provinces.forEach((p) => {
      // 尝试短名映射，也支持 API 直接返回全名
      const fullName = PROVINCE_NAME_MAP[p.province] || p.province;
      dataMap[fullName] = p.count;
    });

    // 为 GeoJSON 中所有省份生成数据点
    const geoMap = echarts.getMap("china");
    const geoFeatures = geoMap?.geoJSON?.features || geoMap?.geoJson?.features || [];
    const mapData = geoFeatures.map((f) => ({
      name: f.properties.name,
      value: dataMap[f.properties.name] || 0,
    }));

    const maxVal = Math.max(...provinces.map((p) => p.count), 1);

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const count = params.value || 0;
          if (count === 0) return `${params.name} — 暂无分析项目`;
          return `<strong>${params.name}</strong><br/>已分析 <strong>${count}</strong> 个项目`;
        },
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        borderColor: "rgba(255, 255, 255, 0.1)",
        textStyle: { color: "#e2e8f0", fontSize: 13 },
        padding: [8, 12],
      },
      visualMap: {
        min: 0,
        max: Math.max(maxVal, 1),
        text: ["多", "少"],
        realtime: false,
        calculable: false,
        inRange: {
          color: ["#1e293b", "#1e40af", "#2563eb", "#3b82f6", "#60a5fa"],
        },
        textStyle: { color: "#94a3b8", fontSize: 11 },
        left: "left",
        bottom: 10,
        itemWidth: 12,
        itemHeight: 80,
      },
      series: [
        {
          type: "map",
          map: "china",
          roam: false,
          label: {
            show: false,
          },
          emphasis: {
            label: { show: true, color: "#fff", fontSize: 12 },
            itemStyle: {
              areaColor: "#f59e0b",
              borderColor: "#fbbf24",
              borderWidth: 1,
            },
          },
          itemStyle: {
            areaColor: "#1e293b",
            borderColor: "rgba(255, 255, 255, 0.15)",
            borderWidth: 0.5,
          },
          data: mapData,
        },
      ],
    });

    // 点击事件
    chart.on("click", (params) => {
      if (params.value > 0 && onProvinceClick) {
        const shortName = PROVINCE_REVERSE_MAP[params.name] || params.name;
        onProvinceClick(shortName);
      }
    });

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
      chartInstance.current = null;
    };
  }, [mapRegistered, provinces, onProvinceClick]);

  if (loadError) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        地图数据加载失败
      </div>
    );
  }

  if (!mapRegistered) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      style={{ width: "100%", height: "420px" }}
    />
  );
}
