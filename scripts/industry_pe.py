#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
行业市盈率查询工具
使用 AkShare 获取行业平均市盈率数据
支持多种数据源 + 模糊关键词匹配
用法: python industry_pe.py <行业关键词>
输出: JSON 到 stdout
"""

import sys
import json

# 常见行业关键词映射（BP 中常见的说法 → AkShare 可能匹配的名称）
INDUSTRY_ALIASES = {
    "人工智能": ["人工智能", "AI", "计算机", "软件", "信息技术"],
    "ai": ["人工智能", "AI", "计算机", "软件", "信息技术"],
    "新能源": ["新能源", "光伏", "锂电", "风电", "电力设备"],
    "光伏": ["光伏", "新能源", "太阳能", "电力设备"],
    "电动车": ["汽车", "新能源汽车", "电动", "锂电"],
    "新能源汽车": ["汽车", "新能源汽车", "电动", "锂电"],
    "医疗": ["医疗", "医药", "生物", "健康", "器械"],
    "医疗器械": ["医疗器械", "医疗", "器械"],
    "医药": ["医药", "制药", "生物医药", "医疗"],
    "生物": ["生物", "医药", "生物科技"],
    "芯片": ["半导体", "芯片", "集成电路", "电子"],
    "半导体": ["半导体", "芯片", "集成电路", "电子"],
    "saas": ["软件", "SaaS", "计算机", "信息技术", "云计算"],
    "云计算": ["云计算", "计算机", "软件", "信息技术"],
    "金融": ["金融", "银行", "保险", "证券"],
    "消费": ["消费", "食品饮料", "零售", "商贸"],
    "房地产": ["房地产", "地产", "建筑"],
    "教育": ["教育", "培训"],
    "游戏": ["游戏", "传媒", "互联网"],
    "互联网": ["互联网", "计算机", "软件", "传媒"],
    "电商": ["电商", "零售", "互联网", "商贸"],
    "物流": ["物流", "交通运输", "快递"],
    "机器人": ["机器人", "自动化", "机械", "智能制造"],
}


def fuzzy_match(df, col_name, keyword):
    """模糊匹配：先精确包含，再尝试别名，再尝试单字匹配"""
    if col_name not in df.columns:
        return df.head(0)  # 空 DataFrame

    # 1) 精确包含匹配
    matched = df[df[col_name].str.contains(keyword, case=False, na=False)]
    if not matched.empty:
        return matched

    # 2) 尝试别名
    aliases = INDUSTRY_ALIASES.get(keyword.lower(), [])
    for alias in aliases:
        matched = df[df[col_name].str.contains(alias, case=False, na=False)]
        if not matched.empty:
            return matched

    # 3) 尝试关键词的每个字单独匹配（至少匹配 2 个字）
    if len(keyword) >= 2:
        for i in range(len(keyword) - 1):
            sub = keyword[i:i+2]
            matched = df[df[col_name].str.contains(sub, case=False, na=False)]
            if not matched.empty:
                return matched

    return df.head(0)


def extract_pe_from_records(records, keyword):
    """从记录中提取市盈率数据"""
    for rec in records:
        for k, v in rec.items():
            k_str = str(k)
            if "市盈率" in k_str or "PE" in k_str.upper() or "pe_ttm" in k_str.lower():
                try:
                    pe = float(v)
                    if 0 < pe < 10000:  # 合理范围
                        name = rec.get("行业名称", rec.get("指数名称", rec.get("板块", keyword)))
                        return pe, name
                except (ValueError, TypeError):
                    pass
    return None, None


def search_industry_pe(keyword: str) -> dict:
    """根据行业关键词搜索行业平均市盈率"""
    try:
        import akshare as ak
    except ImportError:
        return {"error": "akshare 未安装，请运行: pip install akshare", "source": "none"}

    result = {
        "keyword": keyword,
        "industry_pe": None,
        "industry_name": None,
        "source": None,
        "details": [],
    }

    # ── 方法 1: 申万行业市盈率（最细粒度，优先尝试） ──
    try:
        df = ak.sw_index_third_info()
        if df is not None and not df.empty:
            matched = fuzzy_match(df, "行业名称", keyword)
            if not matched.empty:
                records = matched.head(5).to_dict(orient="records")
                result["details"] = records
                pe, name = extract_pe_from_records(records, keyword)
                if pe:
                    result["industry_pe"] = round(pe, 2)
                    result["industry_name"] = name
                    result["source"] = "sw_index_third_info"
    except Exception as e:
        result["sw_error"] = str(e)

    # ── 方法 2: 中证指数行业市盈率 ──
    if result["industry_pe"] is None:
        try:
            df = ak.index_value_name_funddb()
            if df is not None and not df.empty:
                matched = fuzzy_match(df, "指数名称", keyword)
                if not matched.empty:
                    records = matched.head(5).to_dict(orient="records")
                    if not result["details"]:
                        result["details"] = records
                    pe, name = extract_pe_from_records(records, keyword)
                    if pe:
                        result["industry_pe"] = round(pe, 2)
                        result["industry_name"] = name
                        result["source"] = "index_value_name_funddb"
        except Exception as e:
            result["funddb_error"] = str(e)

    # ── 方法 3: 上交所行业市盈率汇总 ──
    if result["industry_pe"] is None:
        try:
            df = ak.stock_sse_summary()
            if df is not None and not df.empty:
                # 上交所汇总数据通常是大盘整体 PE，作为兜底
                records = df.to_dict(orient="records")[:5]
                if not result["details"]:
                    result["details"] = records
                pe, name = extract_pe_from_records(records, keyword)
                if pe:
                    result["industry_pe"] = round(pe, 2)
                    result["industry_name"] = name or "上证综合"
                    result["source"] = "stock_sse_summary"
        except Exception as e:
            result["sse_error"] = str(e)

    # ── 方法 4: 申万一级行业（更宽泛的匹配） ──
    if result["industry_pe"] is None:
        try:
            df = ak.sw_index_first_info()
            if df is not None and not df.empty:
                matched = fuzzy_match(df, "行业名称", keyword)
                if not matched.empty:
                    records = matched.head(5).to_dict(orient="records")
                    if not result["details"]:
                        result["details"] = records
                    pe, name = extract_pe_from_records(records, keyword)
                    if pe:
                        result["industry_pe"] = round(pe, 2)
                        result["industry_name"] = name
                        result["source"] = "sw_index_first_info"
        except Exception as e:
            result["sw_first_error"] = str(e)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: python industry_pe.py <行业关键词>"}, ensure_ascii=False))
        sys.exit(1)

    keyword = sys.argv[1]
    try:
        data = search_industry_pe(keyword)
        print(json.dumps(data, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
