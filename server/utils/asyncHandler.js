// 包装 async route handler，未捕获的 Promise rejection 走 Express 错误中间件
// 而不是变成 unhandledRejection 把请求挂起。
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
