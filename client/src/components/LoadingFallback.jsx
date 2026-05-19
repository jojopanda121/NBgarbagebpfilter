export default function LoadingFallback() {
  return (
    <div className="min-h-screen bg-[#F6F7FA] flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4FD8]" />
        <p className="mt-4 text-[#4B5A72]">加载中...</p>
      </div>
    </div>
  );
}
