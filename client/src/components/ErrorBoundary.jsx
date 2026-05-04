import React from "react";

/**
 * 全局错误边界：防止子组件 crash 导致整页白屏
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary] 组件渲染异常:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F6F7FA] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#D8DCE8] rounded-[6px] p-8 text-center shadow-[0_10px_36px_rgba(13,33,69,0.08)]">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-xl font-semibold text-[#0D2145] mb-2 font-serif-cn">
              页面渲染出错
            </h2>
            <p className="text-[#4B5A72] mb-4 text-sm">
              {this.state.error?.message || "发生了意外错误，请刷新页面重试。"}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-[3px] text-sm transition-colors font-semibold"
              >
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-white border border-[#D8DCE8] hover:bg-[#EEF1F7] text-[#0D2145] rounded-[3px] text-sm transition-colors"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
