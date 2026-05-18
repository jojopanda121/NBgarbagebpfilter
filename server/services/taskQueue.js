// Tiny in-process queue for low-volume deployments.
// Keeps LLM extraction / judge jobs from stampeding a 4 vCPU / 4GB server.

const pLimit = require("p-limit");

const limits = new Map();

function getLimit(name, concurrency) {
  const key = name || "default";
  if (!limits.has(key)) {
    limits.set(key, pLimit(Math.max(1, Number(concurrency) || 1)));
  }
  return limits.get(key);
}

function enqueue(name, fn, opts = {}) {
  const limit = getLimit(name, opts.concurrency || process.env.LIGHTWEIGHT_QUEUE_CONCURRENCY || 1);
  return limit(fn);
}

function fireAndForget(name, fn, opts = {}) {
  enqueue(name, fn, opts).catch((err) => {
    if (opts.logger?.warn) opts.logger.warn(`[Queue/${name}] ${err.message}`);
    else console.warn(`[Queue/${name}]`, err.message);
  });
}

module.exports = { enqueue, fireAndForget };
