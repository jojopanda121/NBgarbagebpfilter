import { useEffect, useCallback } from "react";

// 全屏粒子背景（particles.js，CDN 加载）。仅作背景，位于内容之下。
export default function ParticlesBackground() {
  const initParticles = useCallback((isDark) => {
    // 清理旧 canvas
    const oldCanvas = document.querySelector("#particles-js canvas");
    if (oldCanvas) oldCanvas.remove();

    if (window.pJSDom?.length > 0) {
      window.pJSDom.forEach((p) => p.pJS.fn.vendors.destroypJS());
      window.pJSDom = [];
    }

    // 与网站品牌蓝一致：accent #1749C9 / accent2 #2E63E8
    const colors = isDark
      ? { particles: "#2E63E8", lines: "#2E63E8", accent: "#1749C9" }
      : { particles: "#2E63E8", lines: "#2E63E8", accent: "#1749C9" };

    window.particlesJS("particles-js", {
      particles: {
        number: { value: 140, density: { enable: true, value_area: 800 } },
        color: { value: colors.particles },
        shape: { type: "circle", stroke: { width: 0.5, color: colors.accent } },
        opacity: {
          value: 0.7,
          random: true,
          anim: { enable: true, speed: 1, opacity_min: 0.3 },
        },
        size: {
          value: 3,
          random: true,
          anim: { enable: true, speed: 2, size_min: 1 },
        },
        line_linked: {
          enable: true,
          distance: 160,
          color: colors.lines,
          opacity: 0.4,
          width: 1.2,
        },
        move: { enable: true, speed: 2, random: true, out_mode: "bounce" },
      },
      interactivity: {
        // 监听整个窗口，鼠标在首屏任意位置（含文字上方）都能触发聚合
        detect_on: "window",
        events: {
          // grab：邻近粒子向鼠标连线汇聚；bubble：鼠标附近粒子放大聚拢
          onhover: { enable: true, mode: ["grab", "bubble"] },
          onclick: { enable: true, mode: "push" },
          resize: true,
        },
        modes: {
          grab: { distance: 240, line_linked: { opacity: 1 } },
          bubble: { distance: 220, size: 6, duration: 2, opacity: 1 },
          push: { particles_nb: 4 },
          repulse: { distance: 180, duration: 0.4 },
        },
      },
      retina_detect: true,
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const html = document.documentElement;
    const detectDark = () =>
      html.classList.contains("dark") ||
      html.getAttribute("data-theme") === "dark";

    let observer;

    const start = () => {
      initParticles(detectDark());
      observer = new MutationObserver(() => initParticles(detectDark()));
      observer.observe(html, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    };

    // 若脚本已加载（页面间切换），直接初始化；否则注入 CDN 脚本
    let script;
    if (window.particlesJS) {
      start();
    } else {
      script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/particles.js/2.0.0/particles.min.js";
      script.async = true;
      script.onload = start;
      document.body.appendChild(script);
    }

    return () => {
      observer?.disconnect();
      if (window.pJSDom?.length > 0) {
        window.pJSDom.forEach((p) => p.pJS.fn.vendors.destroypJS());
        window.pJSDom = [];
      }
    };
  }, [initParticles]);

  return (
    <div
      id="particles-js"
      style={{
        // 仅覆盖首屏：absolute + 100vh，向下滚动即移出视口，露出原有背景
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100vh",
        zIndex: 0,
        pointerEvents: "none",
        transition: "background-color 0.5s",
        // 浅色品牌蓝渐变，贴近站点底色 #F4F6FB，整体更通透
        background:
          "linear-gradient(to top right, #F4F6FB, #DDE8FB, #BFD3F4)",
        // 底部渐隐，平滑过渡到下方原有的网状背景
        WebkitMaskImage:
          "linear-gradient(to bottom, #000 82%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, #000 82%, transparent 100%)",
      }}
    />
  );
}
