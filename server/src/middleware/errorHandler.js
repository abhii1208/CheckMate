function notFound(req, res) {
  res.status(404).json({
    message: `Route ${req.originalUrl} was not found.`,
  });
}

function errorHandler(error, req, res, next) {
  console.error(error);

  const status = error.status || error.statusCode || (error.name === 'MulterError' ? 400 : 500);
  const message =
    error.message ||
    (status >= 500 ? 'Something went wrong on the server.' : 'The request could not be completed.');

  res.status(status).json({
    message,
  });
}

module.exports = {
  notFound,
  errorHandler,
};
