function jsonHandler(handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .then((payload) => {
        if (!res.headersSent) res.json(payload);
      })
      .catch(next);
  };
}

module.exports = {
  jsonHandler,
};
