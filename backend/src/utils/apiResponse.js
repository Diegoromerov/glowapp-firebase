// backend/src/utils/apiResponse.js

/**
 * Helper estandarizado para respuestas exitosas JSON en Express
 */
exports.successResponse = (res, message, data = {}, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    ...data
  });
};

/**
 * Helper estandarizado para respuestas de error JSON en Express
 */
exports.errorResponse = (res, error, statusCode = 500) => {
  const errorMsg = typeof error === 'string' ? error : (error && error.message ? error.message : 'Error interno del servidor');
  return res.status(statusCode).json({
    success: false,
    error: errorMsg
  });
};
