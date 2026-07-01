import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "./index.css";
import App from "./App";

const tree = (
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>
);

// 服务端为无 JS 爬虫注入的论坛 SEO 标签（带 data-seo-ssr）：浏览器加载后交还
// react-helmet 管理，先移除以免与 helmet 注入的同名标签重复。<title> 由 helmet 覆盖。
document.querySelectorAll("head [data-seo-ssr]").forEach((el) => el.remove());

const rootElement = document.getElementById("root");

// react-snap 预渲染会把静态 HTML 写进 #root；此时用 hydrateRoot 复用已有 DOM，
// 否则（普通运行时，含论坛 SEO 注入——#root 仍为空）用 createRoot 正常挂载。
if (rootElement.hasChildNodes()) {
  ReactDOM.hydrateRoot(rootElement, tree);
} else {
  ReactDOM.createRoot(rootElement).render(tree);
}
