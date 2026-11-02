// backend/src/helpers/logger.js
const { v4: uuidv4 } = require('uuid');

/**
 * Helper function for standardized logging with traceId support
 * Provides consistent format: [timestamp] [level] [traceId] message
 */
class LoggerHelper {
  /**
   * Create a log entry with traceId and standard format
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {string} message - Log message
   * @param {Object} req - Express request object (optional, for traceId extraction)
   * @returns {string} Formatted log message
   */
  static formatLog(level, message, req = null) {
    const timestamp = new Date().toISOString();
    let traceId = 'NO_TRACE_ID';
    
    // Extract traceId from request if available
    if (req && req.traceId) {
      traceId = req.traceId;
    } else if (typeof global !== 'undefined' && global.traceId) {
      traceId = global.traceId;
    }
    
    // Format: [timestamp] [level] [traceId] message
    return `[${timestamp}] [${level.toUpperCase()}] [${traceId}] ${message}`;
  }

  /**
   * Log info level message
   * @param {string} message - Log message
   * @param {Object} req - Express request object (optional)
   */
  static info(message, req = null) {
    const formatted = this.formatLog('info', message, req);
    console.log(formatted);
  }

  /**
   * Log warn level message
   * @param {string} message - Log message
   * @param {Object} req - Express request object (optional)
   */
  static warn(message, req = null) {
    const formatted = this.formatLog('warn', message, req);
    console.warn(formatted);
  }

  /**
   * Log error level message
   * @param {string} message - Log message
   * @param {Object} req - Express request object (optional)
   */
  static error(message, req = null) {
    const formatted = this.formatLog('error', message, req);
    console.error(formatted);
  }

  /**
   * Log debug level message
   * @param {string} message - Log message
   * @param {Object} req - Express request object (optional)
   */
  static debug(message, req = null) {
    const formatted = this.formatLog('debug', message, req);
    console.debug(formatted);
  }
}

module.exports = LoggerHelper;
