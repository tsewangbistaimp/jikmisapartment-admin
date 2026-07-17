function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(error);
  const status = error.status || 500;
  res.status(status).json({ message: error.message || "Unexpected server error." });
}

module.exports = { errorHandler, notFound };
