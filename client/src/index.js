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

const rootElement = document.getElementById("root");

// react-snap 预渲染会把静态 HTML 写进 #root；此时用 hydrateRoot 复用已有 DOM，
// 否则（普通运行时）用 createRoot 正常挂载。
if (rootElement.hasChildNodes()) {
  ReactDOM.hydrateRoot(rootElement, tree);
} else {
  ReactDOM.createRoot(rootElement).render(tree);
}
