#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
行业市盈率查询工具
使用 AkShare 获取上交所/中证行业平均市盈率数据
用法: python industry_pe.py <行业关键词>
输出: JSON 到 stdout
"""

import sys
import json


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

    # ── 方法 1: 上交所行业市盈率 (stock_sse_summary) ──
    try:
        df = ak.stock_sse_summary()
        if df is not None and not df.empty:
            result["sse_summary"] = df.to_dict(orient="records")[:10]
            result["source"] = "stock_sse_summary"
    except Exception as e:
        result["sse_error"] = str(e)

    # ── 方法 2: 中证指数行业市盈率 ──
    try:
        df = ak.index_value_name_funddb()
        if df is not None and not df.empty:
            # 搜索包含关键词的行业
            matched = df[df["指数名称"].str.contains(keyword, case=False, na=False)]
            if matched.empty:
                # 尝试更宽泛的匹配
                for col in df.columns:
                    if df[col].dtype == object:
                        m = df[df[col].str.contains(keyword, case=False, na=False)]
                        if not m.empty:
                            matched = m
                            break

            if not matched.empty:
                records = matched.head(5).to_dict(orient="records")
                result["details"] = records
                # 提取市盈率
                for rec in records:
                    for k, v in rec.items():
                        if "市盈率" in str(k) or "PE" in str(k).upper():
                            try:
                                pe = float(v)
                                if pe > 0:
                                    result["industry_pe"] = pe
                                    result["industry_name"] = rec.get("指数名称", keyword)
                                    result["source"] = "index_value_name_funddb"
                                    break
                            except (ValueError, TypeError):
                                pass
    except Exception as e:
        result["funddb_error"] = str(e)

    # ── 方法 3: 申万行业市盈率 ──
    try:
        df = ak.sw_index_third_info()
        if df is not None and not df.empty:
            matched = df[df["行业名称"].str.contains(keyword, case=False, na=False)]
            if not matched.empty:
                records = matched.head(5).to_dict(orient="records")
                if not result["details"]:
                    result["details"] = records
                for rec in records:
                    for k, v in rec.items():
                        if "市盈率" in str(k) or "PE" in str(k).upper():
                            try:
                                pe = float(v)
                                if pe > 0 and result["industry_pe"] is None:
                                    result["industry_pe"] = pe
                                    result["industry_name"] = rec.get("行业名称", keyword)
                                    result["source"] = "sw_index_third_info"
                                    break
                            except (ValueError, TypeError):
                                pass
    except Exception as e:
        result["sw_error"] = str(e)

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
