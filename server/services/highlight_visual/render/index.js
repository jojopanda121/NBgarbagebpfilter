const satori = require("satori").default || require("satori");
const { Resvg } = require("@resvg/resvg-js");
const { loadFonts } = require("./fonts");
const { buildTree, CANVAS_W, CANVAS_H } = require("./layout");

async function renderHighlightPng(json) {
  if (!json || typeof json !== "object") {
    throw new Error("[highlight_visual:render] 缺少结构化 JSON 内容");
  }
  const fonts = await loadFonts();
  const tree = buildTree(json);

  const svg = await satori(tree, {
    width: CANVAS_W,
    height: CANVAS_H,
    fonts,
    embedFont: true,
  });

  const resvg = new Resvg(svg, {
    background: "#F6F7FA",
    fitTo: { mode: "width", value: CANVAS_W },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

module.exports = { renderHighlightPng };
