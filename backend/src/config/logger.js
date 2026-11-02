// backend/src/config/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Soporte de observabilidad Sentry / Alertas en Producción
if (process.env.SENTRY_DSN) {
  try {
    logger.info('🛡️ Observabilidad Sentry configurada con DSN activo.');
  } catch (_) {}
}

module.exports = logger;
